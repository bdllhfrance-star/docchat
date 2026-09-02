// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "./request-body";

describe("bounded request body reader", () => {
  test("reads UTF-8 content up to the configured byte limit", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "éé",
    });

    await expect(readBoundedRequestText(request, 4)).resolves.toBe("éé");
  });

  test("rejects an oversized declared content length before reading", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "small",
    });

    await expect(readBoundedRequestText(request, 10)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
    expect(request.bodyUsed).toBe(false);
  });

  test("stops a streamed body as soon as its real size exceeds the limit", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "123456",
    });

    await expect(readBoundedRequestText(request, 5)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});
