export type ObjectLiteral = Record<string, any>;

/**
 * Satisfied by winston-shaped loggers (hub, authup).
 */
export interface ILogger {
    debug(message: unknown, ...meta: unknown[]): unknown;
    info(message: unknown, ...meta: unknown[]): unknown;
    warn(message: unknown, ...meta: unknown[]): unknown;
    error(message: unknown, ...meta: unknown[]): unknown;
}
