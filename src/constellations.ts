// Easter egg: which constellation does a batch look like?
// Two sets of figures are compared. The hand-drawn ones below are rough
// stick-figure sketches, not astronomical data. The rest are real star positions
// for constellations of other sky cultures, loaded at runtime by sky-cultures.ts.
//
// Every name says which tradition it comes from, the Greek and modern European
// ones included, and links the article it was checked against. Names that could
// not be confirmed there were left out.

/** One culture's name for a figure, with where the name comes from and where that was checked. */
interface Name {
  name: string;
  from: string;
  source: string;
  /** Licence of the data the figure was drawn from, where it comes from a published sky culture. */
  license?: string;
  /** Greek and other European names: the ones that otherwise crowd out everything else. */
  dominant?: boolean;
}

export interface Constellation {
  /** What different traditions call the stars of roughly this figure. None is the default. */
  names: Name[];
  stars: [number, number][];
  /** Pairs of star indices to join. */
  lines: [number, number][];
}

const n = (name: string, from: string, page: string): Name => ({ name, from, source: `https://en.wikipedia.org/wiki/${page}` });
// The 48 constellations of Ptolemy's Almagest (2nd century) are Greek figures, later adopted into the international list.
const greek = (name: string, page: string): Name => ({
  ...n(name, "ancient Greek tradition, as listed in Ptolemy's Almagest", page),
  dominant: true,
});
/** A name from elsewhere in the European tradition. */
const european = (name: string, from: string, page: string): Name => ({ ...n(name, from, page), dominant: true });
const asterism = (name: string): Name => ({
  ...n(name, 'a modern nickname from English-language stargazing', 'Asterism_(astronomy)'),
  dominant: true,
});

const chain = (count: number, from = 0): [number, number][] =>
  Array.from({ length: count - 1 - from }, (_, i) => [from + i, from + i + 1]);
const loop = (count: number): [number, number][] => [...chain(count), [count - 1, 0]];
const ring = (count: number, arc = 2 * Math.PI): [number, number][] =>
  Array.from({ length: count }, (_, i): [number, number] => [Math.cos((i * arc) / count), Math.sin((i * arc) / count)]);

const SKETCHED: Constellation[] = [
  {
    names: [
      european("the Big Dipper", "the name used in the United States and Canada", 'Big_Dipper'),
      european("the Plough", "the name used in Britain and Ireland", 'Big_Dipper'),
      european("An Camchéachta, the bent plough", "Irish", 'Big_Dipper'),
      n("Běidǒu (北斗), the Northern Dipper", "Chinese astronomy", 'Big_Dipper'),
      n("Hokuto Shichisei (北斗七星), the Seven Stars of the Northern Dipper", "Japan", 'Big_Dipper'),
      n("Bukdu Chilseong (북두칠성), the Seven Stars of the Northern Dipper", "Korea", 'Big_Dipper'),
      n("Bắc Đẩu thất tinh, the Seven Stars of the Northern Dipper", "Vietnam", 'Big_Dipper'),
      n("Saptarishi, the Seven Sages", "Indian astronomy", 'Big_Dipper'),
      n("Tukturjuit, the Caribou", "Inuit astronomy", 'Inuit_astronomy'),
      european("Charles's Wain, the wagon", "an old name shared across the Germanic languages", 'Big_Dipper'),
    ],
    stars: [[0, 0], [0, 1], [1.2, 1.1], [1.3, 0.1], [2.2, -0.2], [3, -0.5], [3.9, -0.2]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
  },
  {
    names: [
      greek('Orion', 'Orion_(constellation)'),
      n("Shēn (參), the Three Stars", "one of the 28 lunar mansions of Chinese astronomy", 'Three_Stars_(Chinese_constellation)'),
      n("Ullakut", "the Inuit name for Orion", 'Inuit_astronomy'),
      european("Íjász, the Archer", "old Hungarian tradition", 'Orion_(constellation)'),
      european("An Bodach", "Irish and Scottish Gaelic tradition", 'Orion_(constellation)'),
    ],
    stars: [[-1, -1.6], [1, -1.5], [-0.4, 0], [0, 0.1], [0.4, 0.2], [-1.1, 1.7], [1, 1.8], [0, -2.2]],
    lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6], [0, 7], [1, 7], [0, 1]],
  },
  {
    names: [
      european("Orion's Belt", "the English name, after the Greek figure of Orion", "Orion's_Belt"),
      n("Tautoru, the string of three", "Māori tradition", "Orion's_Belt"),
      n("Bintang Tiga Beradik, the three brother stars", "Malay tradition", "Orion's_Belt"),
      n("Las Tres Marías", "the Spanish name used in South America", "Orion's_Belt"),
      european("As Três Marias", "the Portuguese name", "Orion's_Belt"),
      n("Los Tres Reyes Magos", "the name used in Mexico", "Orion's_Belt"),
      european("Väinämöisen vyö, Väinämöinen's Belt", "Finnish mythology", "Orion's_Belt"),
      european("Bírópálca, the Judge's Stick", "Hungarian tradition", 'Orion_(constellation)'),
      n("Al Niṭhām (النظام), the String of Pearls", "Arabic", "Orion's_Belt"),
    ],
    stars: [[-1, 0.1], [0, 0], [1, -0.1]],
    lines: chain(3),
  },
  {
    names: [
      european("the Pleiades", "the ancient Greek name", 'Pleiades'),
      n("Matariki", "Māori tradition", 'Pleiades_in_folklore_and_literature'),
      n("Makaliʻi", "Hawaiian tradition", 'Pleiades'),
      n("Subaru (昴)", "Japan", 'Pleiades_in_folklore_and_literature'),
      n("Myoseong (묘성)", "Korea", 'Pleiades_in_folklore_and_literature'),
      n("Mǎo (昴), the Hairy Head", "a lunar mansion of Chinese astronomy", 'Pleiades_in_folklore_and_literature'),
      n("Kṛttikā, the Cutters", "a nakshatra of Indian astronomy", 'Pleiades_in_folklore_and_literature'),
      n("Dilγéhé", "Navajo (Diné) tradition", 'Pleiades_in_folklore_and_literature'),
      n("al-Thurayya (الثريا)", "Arabic", 'Pleiades_in_folklore_and_literature'),
      n("Parvīn (پروین)", "Persian", 'Pleiades'),
      n("isiLimela", "Xhosa and Zulu, from the verb for cultivating", 'Pleiades_in_folklore_and_literature'),
      n("Selemela", "Sotho and Tswana, from the verb for cultivating", 'Pleiades_in_folklore_and_literature'),
    ],
    stars: [[0, 0], [0.5, 0.1], [0.9, -0.2], [0.6, -0.6], [0.1, -0.5], [1.5, 0], [1.3, 0.3]],
    lines: [...chain(5), [4, 0], [2, 5], [5, 6]],
  },
  {
    names: [
      greek('Cassiopeia', 'Cassiopeia_(constellation)'),
      european("Llys Dôn, the Court of Dôn", "Welsh tradition", 'Cassiopeia_(constellation)'),
      n("Wang-Liang, the great chariot", "Chinese astronomy, which draws it from stars of Cassiopeia", 'Cassiopeia_(constellation)'),
    ],
    stars: [[-2, -0.5], [-1, 0.5], [0, -0.2], [1, 0.6], [2, -0.6]],
    lines: chain(5),
  },
  {
    names: [
      greek('Cygnus', 'Constellation'),
      asterism("the Northern Cross"),
    ],
    stars: [[0, -2], [0, -0.8], [0, 0.6], [0, 2.2], [-1.6, -0.3], [1.6, -0.6]],
    lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
  },
  {
    names: [
      european("Crux, the Southern Cross", "named by European navigators; Crux is its Latin name in the international list", 'Crux'),
      n("Māhutonga, also seen as Te Punga, the anchor of Tama-rereti's canoe", "Māori tradition", 'Crux'),
      n("Chakana", "Quechua, the language of the Inca", 'Crux'),
      n("Melipal, the four stars", "Mapudungun, the language of the Mapuche", 'Crux'),
      n("Toloa, the duck", "Tonga", 'Crux'),
      n("Gubug pèncèng, the raking hut", "Javanese tradition", 'Crux'),
      n("bintoéng bola képpang, the incomplete house star", "Bugis sailors", 'Crux'),
      n("pasil, the spinning top", "Tagalog", 'Crux'),
      n("Shí Zì Jià (十字架), the Cross", "Chinese astronomy", 'Crux'),
      n("Trishanku (त्रिशंकु)", "Indian tradition", 'Crux'),
      asterism("the False Cross"),
    ],
    stars: [[0, -1.5], [0, 1.7], [-1, 0], [1.1, -0.2]],
    lines: [[0, 1], [2, 3]],
  },
  {
    names: [
      greek('Leo', 'Constellation'),
    ],
    stars: [[2, -1], [1.5, -1.6], [0.8, -1.5], [0.6, -0.8], [1, -0.2], [1.2, 0.6], [-1.5, 0.5], [-2.4, 0.2], [-1.6, -0.4]],
    lines: [...chain(9), [8, 3]],
  },
  {
    names: [
      greek('Scorpius', 'Scorpius'),
      n("Ka Makau Nui o Māui, the Big Fishhook of Māui", "Hawaiian tradition", 'Scorpius'),
      n("Banyakangrem, the brooded swan", "Javanese tradition", 'Scorpius'),
      n("Kalapa Doyong, the leaning coconut tree", "Javanese tradition", 'Scorpius'),
    ],
    stars: [[2.2, -1.6], [2.4, -1], [2.3, -0.4], [1.4, -0.8], [0.8, -0.4], [0.3, 0.2], [0, 1], [-0.3, 1.8], [-1, 2.2], [-1.8, 2], [-2.2, 1.4], [-1.9, 0.9]],
    lines: [[0, 3], [1, 3], [2, 3], ...chain(12, 3)],
  },
  {
    names: [
      greek('Lyra', 'Constellation'),
    ],
    stars: [[0, -1.5], [-0.4, -0.6], [0.4, -0.5], [-0.2, 0.8], [0.6, 0.9]],
    lines: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4]],
  },
  {
    names: [
      greek('Draco', 'Constellation'),
    ],
    stars: [[2, -1.5], [2.6, -1.2], [2.5, -0.6], [1.9, -0.8], [1.2, 0], [0.2, 0.6], [-0.8, 0.3], [-1.6, -0.4], [-2.4, -0.2], [-2.8, 0.6], [-2.2, 1.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], ...chain(11, 3)],
  },
  { names: [
      greek('Corona Borealis', 'Corona_Borealis'),
      n("al-Fakkah (الفكة), the broken-up one", "Arabic", 'Corona_Borealis'),
      n("qaṣʿat al-masākīn, the bowl of the poor", "Bedouin tradition", 'Corona_Borealis'),
      european("Caer Arianrhod, the Castle of the Silver Circle", "Welsh mythology", 'Corona_Borealis'),
      european("Darželis, the flower garden", "ancient Baltic tradition", 'Corona_Borealis'),
    ], stars: ring(7, (7 * Math.PI) / 6), lines: chain(7) },
  { names: [
      asterism("the Circlet of Pisces"),
    ], stars: ring(7), lines: loop(7) },
  {
    names: [
      greek('Delphinus', 'Delphinus'),
      n("Te Toloa", "Pukapuka, in the Cook Islands", 'Delphinus'),
      n("Te Uru-o-tiki", "the Tuamotus", 'Delphinus'),
      asterism("Job's Coffin"),
    ],
    stars: [[0, -0.6], [0.6, 0], [0, 0.5], [-0.6, 0], [-1.2, 1.4]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]],
  },
  {
    names: [
      greek('Pegasus', 'Constellation'),
    ],
    stars: [[-1, -1], [1, -1], [1, 1], [-1, 1], [-2, 1.6], [-2.8, 1.2], [2, -1.6], [1.8, -0.4], [2.6, -0.6]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [1, 6], [1, 7], [7, 8]],
  },
  {
    names: [
      n("Nándǒu (南斗), the Six Stars of the Southern Dipper", "Chinese astronomy and Taoism", 'Dipper_(Chinese_constellation)'),
    ],
    stars: [[0, 0], [1, 0.1], [1.1, 1], [0.1, 0.9], [-0.9, -0.4], [-1.7, -0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5]],
  },
  {
    names: [
      asterism("the Teapot of Sagittarius"),
    ],
    stars: [[-1, 0.6], [1, 0.6], [1.4, -0.2], [0.3, -0.5], [-0.8, -0.3], [0, -1.3], [-1.8, 0.1], [2.2, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [3, 5], [4, 5], [4, 6], [0, 6], [2, 7], [1, 7]],
  },
  { names: [
      greek('Cepheus', 'Constellation'),
    ], stars: [[-0.8, 1], [0.8, 1], [0.9, -0.2], [0, -1.3], [-0.9, -0.2]], lines: loop(5) },
  {
    names: [
      greek('Boötes', 'Constellation'),
    ],
    stars: [[0, 1.8], [-0.7, 0.4], [0.6, 0.5], [-0.9, -0.9], [0.7, -1], [0, -1.7]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]],
  },
  {
    names: [
      greek('Corvus', 'Constellation'),
    ],
    stars: [[-1, -0.6], [0.8, -0.9], [1.1, 0.7], [-0.7, 0.9], [-1.4, -0.9]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]],
  },
  {
    names: [
      greek('Aquila', 'Constellation'),
    ],
    stars: [[0, 0], [-0.4, -0.5], [0.4, 0.5], [-1.8, 0.9], [1.6, -1.2], [0.3, 2]],
    lines: [[1, 0], [0, 2], [0, 3], [0, 4], [0, 5]],
  },
  { names: [
      greek('Auriga', 'Constellation'),
    ], stars: [[0, -1.2], [1.2, -0.3], [0.8, 1.1], [-0.7, 1.2], [-1.2, -0.2]], lines: loop(5) },
  {
    names: [
      greek('Canis Major', 'Constellation'),
    ],
    stars: [[0, -1.5], [0.3, -0.5], [-0.9, -0.9], [0.5, 0.6], [1.3, 1.4], [-0.3, 1.3], [-0.9, 1.8], [0.9, -1.6]],
    lines: [[0, 1], [0, 2], [0, 7], [1, 3], [3, 4], [3, 5], [5, 6]],
  },
  {
    names: [
      greek('Gemini', 'Constellation'),
    ],
    stars: [[-0.5, -2], [0.5, -1.9], [-0.6, -0.8], [0.5, -0.7], [-0.7, 0.5], [0.6, 0.6], [-1, 1.7], [0.2, 1.9], [-1.3, 0.9], [1.1, 1.2]],
    lines: [[0, 1], [0, 2], [2, 4], [4, 6], [1, 3], [3, 5], [5, 7], [4, 8], [5, 9]],
  },
  {
    names: [
      greek('Taurus', 'Constellation'),
    ],
    stars: [[0, 0], [0.4, -0.4], [0.8, -0.8], [0.5, 0.3], [1, 0.5], [2.6, -1.6], [2.8, 0.9], [-1.2, 0.3], [-2, 0.5]],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4], [2, 5], [4, 6], [0, 7], [7, 8]],
  },
  {
    names: [
      european("the Hyades", "the ancient Greek name", 'Hyades_(star_cluster)'),
    ],
    stars: [[0, 0], [0.5, -0.4], [1, -0.9], [0.5, 0.3], [1.1, 0.7]],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4]],
  },
  {
    names: [
      greek('Hercules', 'Constellation'),
    ],
    stars: [[-0.5, -0.6], [0.5, -0.7], [0.7, 0.5], [-0.6, 0.6], [-1.4, -1.5], [1.3, -1.7], [1.6, 1.4], [-1.5, 1.5], [-2.2, -1.2], [2.1, 2]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 6], [3, 7], [4, 8], [6, 9]],
  },
  {
    names: [
      asterism("the Keystone of Hercules"),
    ],
    stars: [[-0.5, -0.7], [0.6, -0.6], [0.8, 0.6], [-0.8, 0.7]],
    lines: loop(4),
  },
  { names: [
      asterism("the Summer Triangle"),
    ], stars: [[0, -1.4], [1.6, 0.9], [-1.1, 1.1]], lines: loop(3) },
  { names: [
      european("Triangulum Australe", "first drawn by the Dutch mapmaker Petrus Plancius in 1589", 'Triangulum_Australe'),
    ], stars: [[0, -1], [0.9, 0.6], [-0.9, 0.6]], lines: loop(3) },
  { names: [
      greek('Triangulum', 'Constellation'),
    ], stars: [[-1.5, 0.2], [1.2, -0.4], [1.4, 0.3]], lines: loop(3) },
  {
    names: [
      asterism("the Winter Hexagon"),
    ],
    stars: [[0, -1.5], [1.3, -0.8], [1.4, 0.6], [0.2, 1.6], [-1.2, 0.9], [-1.3, -0.6]],
    lines: loop(6),
  },
  { names: [
      asterism("the Diamond of Virgo"),
    ], stars: [[0, -1.6], [1, 0], [0, 1.3], [-1.1, -0.1]], lines: loop(4) },
  {
    names: [
      asterism("the Coathanger (Brocchi's Cluster)"),
    ],
    stars: [[-1.5, 0], [-0.9, 0], [-0.3, 0], [0.3, 0], [0.9, 0], [1.5, 0], [0.3, 0.4], [0.5, 0.8], [0.1, 1], [-0.2, 0.7]],
    lines: [...chain(6), [3, 6], [6, 7], [7, 8], [8, 9]],
  },
  { names: [
      asterism("the Water Jar of Aquarius"),
    ], stars: [[0, 0], [0, -1], [0.9, 0.5], [-0.9, 0.5]], lines: [[0, 1], [0, 2], [0, 3]] },
  { names: [
      greek('Sagitta, the Arrow', 'Constellation'),
    ], stars: [[-1.5, 0], [0, 0], [1, 0.3], [1, -0.3]], lines: [[0, 1], [1, 2], [1, 3]] },
  { names: [
      greek('Aries', 'Constellation'),
    ], stars: [[-1.4, -0.3], [0.2, 0.2], [0.9, 0.5], [1.1, 0.8]], lines: chain(4) },
  {
    names: [
      greek('Andromeda', 'Constellation'),
    ],
    stars: [[0, 0], [1, -0.2], [2, -0.6], [3, -1.2], [1, 0.3], [2, 0.5], [2.9, 0.4]],
    lines: [[0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 6]],
  },
  {
    names: [
      greek('Perseus', 'Constellation'),
    ],
    stars: [[0, -1.8], [0.1, -0.9], [0, 0], [-0.3, 0.9], [-0.9, 1.6], [0.9, 0.2], [1.4, 1], [1.6, 1.8], [-1, -0.6], [-1.6, 0.2]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6], [6, 7], [1, 8], [8, 9]],
  },
  {
    names: [
      greek('Hydra', 'Constellation'),
    ],
    stars: [[-3.5, -0.6], [-3.2, -1], [-2.8, -0.8], [-2.9, -0.4], [-2.3, 0], [-1.6, 0.5], [-0.8, 0.4], [0, 0.8], [0.9, 0.7], [1.7, 1.1], [2.6, 0.9], [3.4, 1.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], ...chain(12, 3)],
  },
  {
    names: [
      greek('Eridanus, the River', 'Constellation'),
    ],
    stars: [[-2, -1.6], [-1.2, -1.2], [-0.2, -1.3], [0.6, -0.9], [0.3, -0.2], [-0.6, 0.1], [-1.3, 0.5], [-0.8, 1.1], [0.2, 1.3], [1.2, 1.6], [2, 2.2]],
    lines: chain(11),
  },
  {
    names: [
      greek('Capricornus', 'Constellation'),
    ],
    stars: [[-1.6, -0.6], [-0.6, 0.1], [0.3, 0.7], [1.4, 0.3], [1.7, -0.5], [0.6, -0.5], [-0.5, -0.6]],
    lines: loop(7),
  },
  {
    names: [
      greek('Libra', 'Constellation'),
    ],
    stars: [[0, -1], [1, 0], [0.6, 1.2], [-0.9, 0.2], [-1.2, 1.3]],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4], [3, 1]],
  },
  {
    names: [
      european("Grus, the Crane", "drawn by Petrus Plancius in the 1590s from the observations of Dutch navigators", 'Grus_(constellation)'),
    ],
    stars: [[0, -1.8], [0, -0.8], [0, 0.2], [-0.9, 0.9], [0.8, 1], [0.1, 1.5]],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4], [2, 5]],
  },
  {
    names: [
      greek('Ophiuchus', 'Constellation'),
    ],
    stars: [[0, -1.8], [-1.2, -1], [1.2, -1], [-1.4, 0.6], [1.3, 0.7], [-0.4, 1.5], [0.6, 1.6]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 6]],
  },
  {
    names: [
      greek('Cetus', 'Constellation'),
    ],
    stars: [[2, -1], [2.6, -0.5], [2.3, 0.2], [1.6, 0.1], [1.5, -0.6], [0.6, 0.4], [-0.4, 0.8], [-1.4, 0.6], [-2.2, 1], [-1.6, 1.6]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [3, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 6]],
  },
  {
    names: [
      european("Camelopardalis, the Giraffe", "introduced by the Dutch mapmaker Petrus Plancius in 1612–13", 'Camelopardalis'),
    ],
    stars: [[0, -2], [0.2, -1], [0.1, 0], [-0.6, 0.9], [0.8, 1], [-0.9, 1.9], [1.1, 2]],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4], [3, 5], [4, 6]],
  },
  {
    names: [
      european("Lacerta, the Lizard", "created by the astronomer Johannes Hevelius in 1687", 'Lacerta'),
    ],
    stars: [[0, -1.6], [0.4, -1], [-0.3, -0.5], [0.4, 0], [-0.2, 0.6], [0.3, 1.2], [-0.1, 1.7]],
    lines: chain(7),
  },
  { names: [
      european("Chamaeleon", "drawn by Petrus Plancius in the 1590s from the observations of Dutch navigators", 'Chamaeleon'),
    ], stars: [[-1.6, 0], [-0.2, -0.25], [1.5, 0], [0.1, 0.3]], lines: loop(4) },
];

type Pt = [number, number];

/** Centre on the mean and scale so the typical distance from the centre is 1. */
function normalise(pts: Pt[]): Pt[] {
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const rms = Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / pts.length) || 1;
  return pts.map((p) => [(p[0] - mx) / rms, (p[1] - my) / rms]);
}

/** Average distance from each point in `a` to its nearest point in `b`. */
function gap(a: Pt[], b: Pt[]): number {
  let total = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
    total += best;
  }
  return total / a.length;
}

export interface Lookalike {
  /** Stable label for the figure, whichever name is shown. */
  figure: string;
  /** One tradition's name for the figure, where it comes from, and a source for that. */
  name: string;
  from: string;
  source: string;
  license?: string;
  /** Batch points and the constellation, fitted over them, in the same normalised space. */
  points: Pt[];
  stars: Pt[];
  lines: [number, number][];
}

/** Figures scoring within this factor of the best one are all fair answers. */
const CLOSE_ENOUGH = 1.3;

/**
 * A constellation whose shape, at some rotation or mirrored, sits close to
 * these points. Among near-ties the choice varies from batch to batch (but is
 * always the same for the same batch), so not every blob comes out as the same figure.
 */
export function lookalike(cities: { x: number; z: number }[], extra: Constellation[] = []): Lookalike | null {
  if (cities.length < 4) return null;
  const points = normalise(cities.map((c): Pt => [c.x, c.z]));
  const fits = [...SKETCHED, ...extra].map((c) => {
    const base = normalise(c.stars);
    let best = { score: Infinity, stars: base };
    for (const flip of [1, -1]) {
      for (let deg = 0; deg < 360; deg += 15) {
        const cos = Math.cos((deg * Math.PI) / 180);
        const sin = Math.sin((deg * Math.PI) / 180);
        const stars = base.map(([x, y]): Pt => [flip * x * cos - y * sin, flip * x * sin + y * cos]);
        // Stars should land on cities, and cities should not be left far from any star.
        const score = gap(stars, points) + 0.5 * gap(points, stars);
        if (score < best.score) best = { score, stars };
      }
    }
    return { c, ...best };
  }).sort((a, b) => a.score - b.score);

  const close = fits.filter((f) => f.score <= fits[0].score * CLOSE_ENOUGH);
  // A stable number for this batch, whatever order its cities are in.
  const hash = Math.abs(cities.reduce((h, c) => h + c.x * 31 + c.z * 17, 0));
  // Choose a tradition first, then one of its names, so a tradition with hundreds of figures (or the
  // Greek one, which most sketched figures belong to) is no likelier to come up than any other.
  const byTradition = new Map<string, { f: (typeof close)[number]; name: Name }[]>();
  for (const f of close) {
    for (const name of f.c.names) {
      const key = name.dominant ? 'European' : name.from;
      if (!byTradition.has(key)) byTradition.set(key, []);
      byTradition.get(key)!.push({ f, name });
    }
  }
  const traditions = [...byTradition.keys()].sort();
  const options = byTradition.get(traditions[hash % traditions.length])!;
  const { f, name: chosen } = options[(hash >> 3) % options.length];
  const { dominant: _, ...name } = chosen;
  return { figure: f.c.names[0].name, ...name, points, stars: f.stars, lines: f.c.lines };
}
