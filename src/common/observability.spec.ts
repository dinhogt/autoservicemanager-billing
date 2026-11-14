import {
  JsonLogger,
  correlationId,
  CorrelationMiddleware,
  emitMetric,
  withCorrelation,
  withTelemetryContext,
} from './observability';

describe('observability', () => {
  it('propagates supplied and generated correlation IDs', () => {
    const middleware = new CorrelationMiddleware();
    const setHeader = jest.fn();
    const next = jest.fn(() => expect(correlationId()).toBe('correlation-1'));
    middleware.use(
      { header: () => 'correlation-1' } as never,
      { setHeader } as never,
      next,
    );
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'correlation-1');

    middleware.use(
      { header: () => ' ' } as never,
      { setHeader } as never,
      jest.fn(),
    );
    expect(setHeader.mock.calls[1][1]).toEqual(expect.any(String));
    expect(withCorrelation('manual', correlationId)).toBe('manual');
  });

  it('writes JSON logs at every level', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const logger = new JsonLogger();
    withCorrelation('correlation-1', () => {
      logger.log('hello', 'Test');
      logger.error('failed', 'trace', 'Test');
      logger.warn({ warning: true }, 'Test');
      logger.debug('debug');
      logger.verbose('verbose');
    });
    expect(write).toHaveBeenCalledTimes(5);
    expect(write.mock.calls[0][0]).toContain('"correlationId":"correlation-1"');
    expect(write.mock.calls[1][0]).toContain('"trace":"trace"');
    expect(write.mock.calls[2][0]).toContain('warning');
    write.mockRestore();
  });

  it('emits EMF with the complete message context', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    withTelemetryContext(
      {
        correlationId: 'corr-1',
        sagaId: 'saga-1',
        messageId: 'message-1',
        aggregateId: 'order-1',
      },
      () =>
        emitMetric({
          event: 'refund_failed',
          metric: 'RefundFailed',
          operation: 'refund',
          outcome: 'failed',
        }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('"sagaId":"saga-1"'),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('"RefundFailed":1'),
    );
    write.mockRestore();
  });
});
