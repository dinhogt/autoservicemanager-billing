import { createHmac, timingSafeEqual } from 'node:crypto';

export class WebhookSignatureService {
  constructor(
    private readonly secret: string,
    private readonly enabled: boolean,
  ) {}

  validate(input: {
    dataId: string;
    requestId: string;
    signature?: string;
  }): boolean {
    if (!this.enabled) return true;
    if (!input.signature || !this.secret) return false;

    const parts = Object.fromEntries(
      input.signature.split(',').map((part) => {
        const [key, value] = part.trim().split('=');
        return [key, value];
      }),
    );
    const timestamp = parts.ts;
    const received = parts.v1;
    if (!timestamp || !received) return false;

    const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${timestamp};`;
    const expected = createHmac('sha256', this.secret)
      .update(manifest)
      .digest('hex');
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  }
}
