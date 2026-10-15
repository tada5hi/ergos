/**
 * Captured from hub's AmqpMessageBusDriver (privateaim/hub bb6cf177d,
 * packages/server-kit/src/message-bus/driver/amqp.ts) against a recording fake
 * Client, with id 'msg-1' and timestamp 1700000000000. Do not edit by hand:
 * it pins wire compatibility with hub's deployed producers and consumers.
 */
export const hubWireFixture = {
    'work': [
        {
            'op': 'publish',
            'exchange': {
                'type': 'direct',
                'name': '',
            },
            'key': 'tasks',
            'body': '{"id":"msg-1","type":"execute","data":{"id":"a"},"metadata":{"timestamp":1700000000000,"routing":{"type":"work","key":"tasks"}}}',
            'options': {
                'type': 'execute',
                'messageId': 'msg-1',
                'persistent': true,
            },
        },
        {
            'op': 'consume',
            'exchange': {
                'type': 'direct',
                'name': '',
            },
            'key': 'tasks',
            'options': {
                'prefetchCount': 1,
                'requeueOnFailure': true,
            },
        },
    ],
    'workOrdered': [
        {
            'op': 'publish',
            'exchange': {
                'type': 'direct',
                'name': '',
            },
            'key': 'replies',
            'body': '{"id":"msg-1","type":"execute","data":{"id":"a"},"metadata":{"timestamp":1700000000000,"routing":{"type":"work","key":"replies","ordered":true}}}',
            'options': {
                'type': 'execute',
                'messageId': 'msg-1',
                'persistent': true,
                'singleActiveConsumer': true,
            },
        },
        {
            'op': 'consume',
            'exchange': {
                'type': 'direct',
                'name': '',
            },
            'key': 'replies',
            'options': {
                'prefetchCount': 1,
                'requeueOnFailure': true,
                'singleActiveConsumer': true,
            },
        },
    ],
    'pubSubNamespace': [
        {
            'op': 'publish',
            'exchange': {
                'type': 'topic',
                'name': 'custom',
            },
            'key': 'events',
            'body': '{"id":"msg-1","type":"execute","data":{"id":"a"},"metadata":{"timestamp":1700000000000,"routing":{"type":"pubSub","key":"events","namespace":"custom"}}}',
            'options': {
                'type': 'execute',
                'messageId': 'msg-1',
                'persistent': false,
            },
        },
        {
            'op': 'consume',
            'exchange': {
                'type': 'topic',
                'name': 'custom',
            },
            'key': 'events',
            'options': {
                'prefetchCount': 1,
                'requeueOnFailure': false,
            },
        },
    ],
    'pubSub': [
        {
            'op': 'publish',
            'exchange': {
                'type': 'topic',
                'name': 'FLAME',
            },
            'key': 'events',
            'body': '{"id":"msg-1","type":"execute","data":{"id":"a"},"metadata":{"timestamp":1700000000000,"routing":{"type":"pubSub","key":"events"}}}',
            'options': {
                'type': 'execute',
                'messageId': 'msg-1',
                'persistent': false,
            },
        },
        {
            'op': 'consume',
            'exchange': {
                'type': 'topic',
                'name': 'FLAME',
            },
            'key': 'events',
            'options': {
                'prefetchCount': 1,
                'requeueOnFailure': false,
            },
        },
    ],
    'workRetry': [
        {
            'op': 'publish',
            'exchange': {
                'type': 'direct',
                'name': '',
            },
            'key': 'tasks',
            'body': '{"id":"msg-1","type":"execute","data":{"id":"a"},"metadata":{"timestamp":1700000000000,"routing":{"type":"work","key":"tasks"},"attempt":2}}',
            'options': {
                'type': 'execute',
                'messageId': 'msg-1',
                'persistent': true,
            },
        },
    ],
} as const;
