import type {
    ConsumeOptions,
    Exchange,
    PublishOptions,
} from 'amqp-extension';
import type { AmqpDeliveryHandler, IAmqpClient } from '../../../src';

export type FakeAmqpPublish = {
    exchange: Exchange, 
    key: string, 
    body: string, 
    options: PublishOptions 
};
export type FakeAmqpConsume = {
    exchange: Exchange,
    key: string,
    options: ConsumeOptions,
    handler: AmqpDeliveryHandler,
    cancelled: boolean,
    inFlight: Set<Promise<void>>,
};

type FakeAmqpLog = {
    publishes: FakeAmqpPublish[],
    consumes: FakeAmqpConsume[],
    closed?: number,
    loopback?: { index: number },
};

/**
 * Records what the driver hands amqp-extension; of() siblings share the log.
 * FakeAmqpClient.loopback() also delivers each publish to the matching consumers:
 * the default exchange round-robins (a queue), any other fans out (a queue per
 * consumer, or one per options.queue, shared round-robin).
 * ponytail: no queue buffering, no retry; a handler error is dropped.
 */
export class FakeAmqpClient implements IAmqpClient {
    protected exchange: Exchange;

    protected log: FakeAmqpLog;

    constructor(exchange: Exchange = { type: 'direct' }, log?: FakeAmqpLog) {
        this.exchange = exchange;
        this.log = log ?? {
            publishes: [], 
            consumes: [], 
        };
    }

    static loopback(): FakeAmqpClient {
        return new FakeAmqpClient(undefined, {
            publishes: [],
            consumes: [],
            loopback: { index: 0 },
        });
    }

    get publishes() { return this.log.publishes; }

    get consumes() { return this.log.consumes; }

    get closed() { return this.log.closed ?? 0; }

    of(exchange: Exchange): FakeAmqpClient {
        return new FakeAmqpClient(exchange, this.log);
    }

    async publish(key: string, body: string, options: PublishOptions): Promise<boolean> {
        this.log.publishes.push({
            exchange: this.exchange, 
            key, 
            body, 
            options, 
        });

        const { loopback } = this.log;
        if (loopback) {
            const matching = this.log.consumes.filter((entry) => !entry.cancelled &&
                entry.key === key &&
                entry.exchange.type === this.exchange.type &&
                (entry.exchange.name || '') === (this.exchange.name || ''));
            // a queue (the default exchange's, or a named one) delivers once, round-robin
            const queues = Map.groupBy(matching, (entry) => (this.exchange.name ? entry.options.queue ?? entry : ''));
            const targets = queues.values().toArray().map((group) => group[loopback.index++ % group.length]!);
            for (const entry of targets) {
                const handled = Promise.resolve()
                    .then(() => entry.handler({ content: Buffer.from(body), properties: {} }))
                    .catch(() => {});
                entry.inFlight.add(handled);
                handled.then(() => entry.inFlight.delete(handled));
            }
        }

        return true;
    }

    async consume(key: string, options: ConsumeOptions, handlers: { $any: AmqpDeliveryHandler }) {
        const entry: FakeAmqpConsume = {
            exchange: this.exchange, 
            key, 
            options, 
            handler: handlers.$any, 
            cancelled: false, 
            inFlight: new Set(),
        };
        this.log.consumes.push(entry);

        return {
            cancel: async () => {
                entry.cancelled = true;
                await Promise.all(entry.inFlight);
            },
        };
    }

    close() {
        this.log.closed = this.closed + 1;
        return Promise.resolve();
    }
}
