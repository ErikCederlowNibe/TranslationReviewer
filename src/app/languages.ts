export const SUPPORTED_LANGUAGES = [
  'English',
  'Swedish',
  'German',
  'French',
  'Spanish',
  'Finnish',
  'Lithuanian',
  'Czech',
  'Polish',
  'Dutch',
  'Norwegian',
  'Danish',
  'Estonian',
  'Latvian',
  'Russian',
  'Italian',
  'Hungarian',
  'Slovenian',
  'Turkish',
  'Croatian',
  'Romanian',
  'Icelandic',
  'Slovak',
  'Ukrainian',
  'Bulgarian',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_PASSWORDS: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((lang) => [lang, `${lang.toLowerCase()}-review`])
);
