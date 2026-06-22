export const SUPPORTED_LANGUAGES = [
  'Bulgarian',
  'Croatian',
  'Czech',
  'Danish',
  'Dutch',
  'Estonian',
  'Finnish',
  'French',
  'German',
  'Hungarian',
  'Icelandic',
  'Italian',
  'Latvian',
  'Lithuanian',
  'Norwegian',
  'Polish',
  'Romanian',
  'Russian',
  'Slovak',
  'Slovenian',
  'Spanish',
  'Swedish',
  'Turkish',
  'Ukrainian',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_CODES: Record<SupportedLanguage, string> = {
  Bulgarian: 'BG',
  Croatian: 'HR',
  Czech: 'CZ',
  Danish: 'DK',
  Dutch: 'NL',
  Estonian: 'EE',
  Finnish: 'FI',
  French: 'FR',
  German: 'DE',
  Hungarian: 'HU',
  Icelandic: 'IS',
  Italian: 'IT',
  Latvian: 'LV',
  Lithuanian: 'LT',
  Norwegian: 'NO',
  Polish: 'PL',
  Romanian: 'RO',
  Russian: 'RU',
  Slovak: 'SK',
  Slovenian: 'SI',
  Spanish: 'ES',
  Swedish: 'SE',
  Turkish: 'TR',
  Ukrainian: 'UA',
};

export function getLanguageCode(language: SupportedLanguage): string {
  return LANGUAGE_CODES[language] ?? '??';
}

export const LANGUAGE_PASSWORDS: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((lang) => [lang, `${lang.toLowerCase()}-review`])
);
