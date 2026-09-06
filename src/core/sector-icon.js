// ============================================================
// sector-icon.js - map a sector name to an emoji icon.
//
// Pure, DOM-free, testable. Keyword-matched (ordered MOST-SPECIFIC first) so
// distinct sectors get distinct icons and variants ("Real Estate (REIT)",
// "Transport & Logistics") still resolve. The UI (04-render.js) delegates here
// via globalThis.__core.sectorIcon so the mapping has a single source of truth
// and a coverage test can assert every real sector gets a sensible, distinct
// icon.
// ============================================================

// [regex, emoji]. Order matters: earlier rules win.
export const SECTOR_ICON_RULES = [
  [/reit/, "\uD83C\uDFEC"], // REIT -> department store building
  [/real estate/, "\uD83C\uDFE0"], // real estate -> house
  [/building material|building|cement/, "\uD83E\uDDF1"], // building materials -> brick
  [/construc/, "\uD83C\uDFD7\uFE0F"], // construction -> crane
  [/insur/, "\uD83D\uDEE1\uFE0F"], // insurance -> shield
  [/telecom/, "\uD83D\uDCF6"], // telecom -> signal bars
  [/tech/, "\uD83D\uDCBB"], // technology -> laptop
  [/bank/, "\uD83C\uDFE6"], // banking -> bank
  [/financ/, "\uD83D\uDCB0"], // financial services -> money bag
  [/leasing/, "\uD83D\uDCC4"], // leasing -> document
  [/utilit/, "\uD83D\uDCA1"], // utilities -> bulb
  [/energy|oil|gas|petrol/, "\u26FD"], // energy -> fuel pump
  [/mining|metal/, "\u26CF\uFE0F"], // mining -> pick
  [/auto/, "\uD83D\uDE97"], // automotive -> car
  [/beverage|drink/, "\uD83C\uDF7A"], // beverages -> drinks
  [/food/, "\uD83C\uDF5E"], // food producers -> bread
  [/consumer/, "\uD83D\uDECD\uFE0F"], // consumer goods -> shopping bags
  [/retail/, "\uD83D\uDED2"], // retail -> shopping cart
  [/forest|paper/, "\uD83C\uDF32"], // forestry & paper -> evergreen tree
  [/agri/, "\uD83C\uDF3E"], // agriculture -> sheaf of rice
  [/chemical/, "\uD83E\uDDEA"], // chemicals -> test tube
  [/health|pharma|medic/, "\uD83C\uDFE5"], // healthcare -> hospital
  [/logistic|transport|shipping/, "\uD83D\uDE9B"], // transport & logistics -> truck
  [/tourism|hotel|leisure|travel/, "\uD83C\uDFD6\uFE0F"], // tourism -> beach
  [/industr/, "\uD83C\uDFED"], // industrial goods -> factory
  [/holding/, "\uD83C\uDFE2"], // holding -> office building
  [/opcvm|fund/, "\uD83D\uDCCA"], // funds -> bar chart
];

// Default tag when no rule matches.
export const SECTOR_ICON_DEFAULT = "\uD83C\uDFF7\uFE0F";

/** Return the emoji icon for a sector name. */
export function sectorIcon(name) {
  const s = String(name || "").toLowerCase();
  for (const [re, ic] of SECTOR_ICON_RULES) if (re.test(s)) return ic;
  return SECTOR_ICON_DEFAULT;
}
