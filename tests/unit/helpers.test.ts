import { describe, expect, it } from "vitest";

import {
  normalizeBillNumber,
  searchStateSchema,
  stateCodeSchema,
  extractTextFromDoc,
} from "../../src/tools/helpers.js";

describe("normalizeBillNumber", () => {
  it("normalizes common bill number formats", () => {
    expect(normalizeBillNumber("AB 858")).toBe("AB858");
    expect(normalizeBillNumber("ab-858")).toBe("AB858");
    expect(normalizeBillNumber("SB.0012")).toBe("SB12");
  });
});

describe("extractTextFromDoc", () => {
  it("strips HTML tags from an HTML document (mime_id=1)", async () => {
    const html = "<h1>Bill Title</h1><p>Section 1: <strong>The act</strong> shall apply.</p>";
    const base64 = Buffer.from(html).toString("base64");
    const result = await extractTextFromDoc(1, base64);
    expect(result).toContain("Bill Title");
    expect(result).toContain("Section 1:");
    expect(result).toContain("The act");
    expect(result).not.toContain("<h1>");
    expect(result).not.toContain("<strong>");
  });

  it("collapses extra whitespace produced by tag removal", async () => {
    const html = "<p>  Too   many   spaces  </p>";
    const base64 = Buffer.from(html).toString("base64");
    const result = await extractTextFromDoc(1, base64);
    expect(result).toBe("Too many spaces");
  });

  it("returns raw UTF-8 text for unknown mime types (fallback)", async () => {
    const text = "Plain text content from the legislature.";
    const base64 = Buffer.from(text).toString("base64");
    const result = await extractTextFromDoc(99, base64);
    expect(result).toBe(text);
  });

  it("returns a string (not an error) for a PDF document (mime_id=2)", async () => {
    // Minimal syntactically valid PDF — no embedded text layer, so pdf-parse
    // returns an empty string, but should not throw.
    const minimalPdf = [
      "%PDF-1.4",
      "1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj",
      "2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj",
      "3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 3 3]>>endobj",
      "xref",
      "0 4",
      "0000000000 65535 f ",
      "0000000009 00000 n ",
      "0000000058 00000 n ",
      "0000000115 00000 n ",
      "trailer<</Size 4 /Root 1 0 R>>",
      "startxref",
      "190",
      "%%EOF",
    ].join("\n");
    const base64 = Buffer.from(minimalPdf).toString("base64");
    const result = await extractTextFromDoc(2, base64);
    expect(typeof result).toBe("string");
  });
});

describe("state schemas", () => {
  it("normalizes two-letter state abbreviations", () => {
    expect(stateCodeSchema.parse("ca")).toBe("CA");
  });

  it("rejects invalid two-letter state abbreviations", () => {
    expect(() => stateCodeSchema.parse("CAL")).toThrow(
      "State must be a two-letter abbreviation"
    );
  });

  it("accepts ALL for search state", () => {
    expect(searchStateSchema.parse("all")).toBe("ALL");
  });
});
