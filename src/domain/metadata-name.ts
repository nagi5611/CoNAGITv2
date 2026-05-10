/**
 * src/domain/metadata-name.ts — プロジェクト／フォルダ／ファイル表示名の検証（要件 R59 相当）
 */
import { HttpError } from "../http/errors.js";

const MAX_LEN = 255;
/** 制御文字（タブ・改行除く）と DEL を拒否。タブ・改行は名前として不自然なため含めない */
const INVALID_CHARS = /[\x00-\x1F\x7F]/;

export function parseMetadataName(raw: unknown, fieldLabel: string): string {
  if (typeof raw !== "string") {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${fieldLabel} は文字列である必要があります`,
    );
  }
  const t = raw.trim();
  if (!t) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${fieldLabel} は空にできません`,
    );
  }
  if (t.length > MAX_LEN) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${fieldLabel} は ${MAX_LEN} 文字以内としてください`,
    );
  }
  if (INVALID_CHARS.test(t)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${fieldLabel} に使用できない文字が含まれています`,
    );
  }
  return t;
}
