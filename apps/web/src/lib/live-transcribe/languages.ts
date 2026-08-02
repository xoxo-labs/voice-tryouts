export interface LanguageOption {
  /** ISO 639-1 where one exists, otherwise a code the Realtime API accepts. */
  code: string;
  /** Endonym — what speakers call the language. */
  label: string;
  /** English name, for searchability and for disambiguating the endonym. */
  english: string;
}

/**
 * Common languages for the picker. `gpt-live-transcribe` takes the plural
 * `languages` array; codes outside this list can still be typed manually.
 *
 * English and Romanian lead because this project is used from Romania.
 */
export const COMMON_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", english: "English" },
  { code: "ro", label: "Română", english: "Romanian" },
  { code: "fr", label: "Français", english: "French" },
  { code: "de", label: "Deutsch", english: "German" },
  { code: "es", label: "Español", english: "Spanish" },
  { code: "it", label: "Italiano", english: "Italian" },
  { code: "pt", label: "Português", english: "Portuguese" },
  { code: "nl", label: "Nederlands", english: "Dutch" },
  { code: "pl", label: "Polski", english: "Polish" },
  { code: "cs", label: "Čeština", english: "Czech" },
  { code: "hu", label: "Magyar", english: "Hungarian" },
  { code: "sv", label: "Svenska", english: "Swedish" },
  { code: "da", label: "Dansk", english: "Danish" },
  { code: "fi", label: "Suomi", english: "Finnish" },
  { code: "no", label: "Norsk", english: "Norwegian" },
  { code: "el", label: "Ελληνικά", english: "Greek" },
  { code: "bg", label: "Български", english: "Bulgarian" },
  { code: "uk", label: "Українська", english: "Ukrainian" },
  { code: "ru", label: "Русский", english: "Russian" },
  { code: "tr", label: "Türkçe", english: "Turkish" },
  { code: "ar", label: "العربية", english: "Arabic" },
  { code: "he", label: "עברית", english: "Hebrew" },
  { code: "hi", label: "हिन्दी", english: "Hindi" },
  { code: "zh", label: "中文", english: "Chinese" },
  { code: "ja", label: "日本語", english: "Japanese" },
  { code: "ko", label: "한국어", english: "Korean" },
  { code: "vi", label: "Tiếng Việt", english: "Vietnamese" },
  { code: "th", label: "ไทย", english: "Thai" },
  { code: "id", label: "Bahasa Indonesia", english: "Indonesian" },
];

const BY_CODE = new Map(COMMON_LANGUAGES.map((item) => [item.code, item]));

export function findLanguage(code: string): LanguageOption | undefined {
  return BY_CODE.get(code);
}

/** Human label for a code, falling back to the raw code for custom entries. */
export function languageLabel(code: string): string {
  const match = BY_CODE.get(code);
  return match ? match.label : code;
}
