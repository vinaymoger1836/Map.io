/**
 * Alliance and union membership, keyed by ISO 3166-1 numeric code — the same
 * identifier world-atlas uses for its country features, so a bloc becomes a
 * one-line filter rather than a second copy of the world's geometry.
 *
 * To correct or extend a bloc, edit the list. Codes are strings because that
 * is how they arrive from TopoJSON.
 */

export type BlocId = 'nato' | 'eu' | 'csto' | 'eaeu';

export interface Bloc {
  id: BlocId;
  label: string;
  members: string[];
  note: string;
}

export const BLOCS: Record<BlocId, Bloc> = {
  nato: {
    id: 'nato',
    label: 'NATO',
    note: 'Thirty-two members. Finland joined in 2023 and Sweden in 2024, roughly doubling the alliance\u2019s land border with Russia and turning the Baltic into an almost entirely NATO-rimmed sea.',
    members: [
      '008', '056', '100', '124', '191', '203', '208', '233', '246', '250',
      '276', '300', '348', '352', '380', '428', '440', '442', '499', '528',
      '578', '616', '620', '642', '703', '705', '724', '752', '792', '807',
      '826', '840',
    ],
  },
  eu: {
    id: 'eu',
    label: 'European Union',
    note: 'Twenty-seven members. Ukraine, Moldova, Georgia and the Western Balkan states hold candidate status at varying stages.',
    members: [
      '040', '056', '100', '191', '196', '203', '208', '233', '246', '250',
      '276', '300', '348', '372', '380', '428', '440', '442', '470', '528',
      '616', '620', '642', '703', '705', '724', '752',
    ],
  },
  csto: {
    id: 'csto',
    label: 'CSTO',
    note: 'Russia\u2019s collective security treaty with Belarus, Kazakhstan, Kyrgyzstan, Tajikistan and Armenia. Armenia froze its participation in 2024 after concluding the bloc would not defend it.',
    members: ['051', '112', '398', '417', '643', '762'],
  },
  eaeu: {
    id: 'eaeu',
    label: 'Eurasian Economic Union',
    note: 'The economic counterpart to the CSTO: Russia, Belarus, Kazakhstan, Kyrgyzstan and Armenia, with a common customs area.',
    members: ['051', '112', '398', '417', '643'],
  },
};

/** Countries drawn with a neutral outline even though they sit in no bloc. */
export const NEUTRAL_NOTE =
  'Austria, Ireland, Malta, Cyprus, Switzerland and Serbia sit outside NATO; Norway, Iceland, Türkiye and the United Kingdom sit outside the EU. The two outlines rarely coincide.';
