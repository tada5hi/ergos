import type {
    ConsumeOptions,
    Exchange,
    PublishOptions,
} from 'amqp-extension';
import type { AmqpDeliveryHandler, IAmqpClient } from '../../../src/amqp';

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
};

type FakeAmqpLog = {
    publishes: FakeAmqpPublish[],
    consumes: FakeAmqpConsume[],
    closed: number,
};

/**
 * Records what the driver hands amqp-extension; of() siblings share the log.
 */
export class FakeAmqpClient implements IAmqpClient {
    protected exchange: Exchange;

    protected log: FakeAmqpLog;

    constructor(exchange: Exchange = { type: 'direct' }, log?: FakeAmqpLog) {
        this.exchange = exchange;
        this.log = log ?? {
            publishes: [], 
            consumes: [], 
            closed: 0, 
        };
    }

    get publishes() { return this.log.publishes; }

    get consumes() { return this.log.consumes; }

    get closed() { return this.log.closed; }

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
        return true;
    }

    async consume(key: string, options: ConsumeOptions, handlers: { $any: AmqpDeliveryHandler }) {
        const entry: FakeAmqpConsume = {
            exchange: this.exchange, 
            key, 
            options, 
            handler: handlers.$any, 
            cancelled: false, 
        };
        this.log.consumes.push(entry);

        return {
            cancel: async () => {
                entry.cancelled = true;
            },
        };
    }

    async close() {
        this.log.closed++;
    }
}
