import type { ILogger } from '../../../src';

export class FakeLogger implements ILogger {
    calls: { level: string, message: unknown }[] = [];

    debug(message: unknown) { this.calls.push({ level: 'debug', message }); }

    info(message: unknown) { this.calls.push({ level: 'info', message }); }

    warn(message: unknown) { this.calls.push({ level: 'warn', message }); }

    error(message: unknown) { this.calls.push({ level: 'error', message }); }

    messages(level: string) {
        return this.calls.filter((call) => call.level === level).map((call) => call.message);
    }
}
