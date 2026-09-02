export class RequestBodyTooLargeError extends Error {
  constructor(readonly maximumBytes: number) {
    super(`The request body exceeds ${maximumBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readBoundedRequestText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("The request body limit must be a positive integer.");
  }

  const contentLength = request.headers.get("content-length");

  if (
    contentLength &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > maximumBytes
  ) {
    throw new RequestBodyTooLargeError(maximumBytes);
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        return text + decoder.decode();
      }

      bytesRead += value.byteLength;

      if (bytesRead > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maximumBytes);
      }

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
