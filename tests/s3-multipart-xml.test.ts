/**
 * tests/s3-multipart-xml.test.ts — CompleteMultipartUpload XML builder
 */
import { describe, expect, it } from "vitest";
import { buildCompleteMultipartXml } from "../src/s3/s3-api.js";

describe("buildCompleteMultipartXml", () => {
  it("orders parts by partNumber and wraps etag in quotes", () => {
    const xml = buildCompleteMultipartXml([
      { partNumber: 2, etag: "bbb" },
      { partNumber: 1, etag: '"aaa"' },
    ]);
    expect(xml).toContain("<PartNumber>1</PartNumber>");
    expect(xml).toContain('<ETag>"aaa"</ETag>');
    expect(xml.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(
      xml.indexOf("<PartNumber>2</PartNumber>"),
    );
    expect(xml).toContain('<ETag>"bbb"</ETag>');
  });
});
