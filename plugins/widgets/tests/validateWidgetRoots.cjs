const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../ios/AJFitWidgetsExtension/AJFitWidgets.swift');
const source = fs.readFileSync(sourcePath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(`AJFit widget root validation failed: ${message}`);
}

const expectedConfigurations = [
  ['AJFitMonthlyWidget', 'AJFitMonthlyCalendar', 'MonthlyEntryView', '[.systemMedium, .systemLarge]'],
  ['AJFitWeeklyWidget', 'AJFitWeeklyStreak', 'WeeklyEntryView', '[.systemMedium]'],
  ['AJFitCompactWidget', 'AJFitCompactStreak', 'CompactEntryView', '[.systemSmall]'],
  ['AJFitFrequencyWidget', 'AJFitFrequency', 'FrequencyEntryView', '[.systemSmall, .systemMedium, .systemLarge]'],
];

for (let index = 0; index < expectedConfigurations.length; index += 1) {
  const [widget, kind, entryView, families] = expectedConfigurations[index];
  const start = source.indexOf(`struct ${widget}: Widget`);
  const nextWidget = expectedConfigurations[index + 1]?.[0];
  const end = nextWidget ? source.indexOf(`struct ${nextWidget}: Widget`, start) : source.length;
  assert(start >= 0 && end > start, `${widget} configuration is missing`);
  const block = source.slice(start, end);
  assert(block.includes(`let kind = "${kind}"`), `${widget} kind changed unexpectedly`);
  assert(block.includes(`AJFitWidgetRoot { ${entryView}(entry: entry) }`),
    `${widget} does not return AJFitWidgetRoot directly from StaticConfiguration`);
  assert(block.includes(`.supportedFamilies(${families})`), `${widget} families changed unexpectedly`);
  assert(block.includes('.contentMarginsDisabled()'), `${widget} margin policy is missing`);
}

assert((source.match(/containerBackground\(for: \.widget\)/g) ?? []).length === 1,
  'containerBackground must have exactly one implementation point');
assert((source.match(/\.ajFitWidgetBackground\(\)/g) ?? []).length === 1,
  'the background helper must be applied exactly once, by AJFitWidgetRoot');

const canvasStart = source.indexOf('private struct AJFitCanvas');
const rootStart = source.indexOf('private struct AJFitWidgetRoot');
assert(canvasStart >= 0 && rootStart > canvasStart, 'shared canvas/root declarations are missing');
assert(!source.slice(canvasStart, rootStart).includes('ajFitWidgetBackground'),
  'AJFitCanvas must not apply a second container background');

const weekStripStart = source.indexOf('private struct WeekStrip');
const compactStart = source.indexOf('private struct CompactStreakView');
assert(weekStripStart >= 0 && compactStart > weekStripStart, 'WeekStrip is missing');
const weekStrip = source.slice(weekStripStart, compactStart);
assert(weekStrip.includes('case .missed: return .clear'), 'MISSED must have a transparent fill');
assert(weekStrip.includes('if day.status == .missed { return AJFitColors.primary }'),
  'MISSED must use the AJ Fit blue border');
assert(weekStrip.includes('day.status == .missed ? AJFitColors.primary : .white'),
  'MISSED must use the AJ Fit blue xmark');
assert(!weekStrip.includes('AJFitColors.danger'), 'MISSED must not use the red danger token');

const frequencyMetricsStart = source.indexOf('private struct AJFitFrequencyMetrics');
const frequencyStart = source.indexOf('private struct FrequencyView');
const isoFormatterStart = source.indexOf('private extension ISO8601DateFormatter');
assert(frequencyMetricsStart >= 0 && frequencyStart > frequencyMetricsStart,
  'Frequency family metrics are missing');
const frequencyMetrics = source.slice(frequencyMetricsStart, frequencyStart);
for (const family of ['.systemSmall', '.systemMedium', '.systemLarge']) {
  assert(frequencyMetrics.includes(family), `Frequency metrics do not cover ${family}`);
}
const frequency = source.slice(frequencyStart, isoFormatterStart);
assert(frequency.includes('Image("AJFitLogo")'), 'Frequency header must use the official logo');
assert(frequency.indexOf('Image("AJFitLogo")') < frequency.indexOf('LazyVGrid'),
  'Frequency logo must remain in the header');
assert(frequency.indexOf('Text("30 DIAS")') > frequency.indexOf('LazyVGrid'),
  '30 DIAS must remain in the footer');
assert(!frequency.includes('scaleEffect') && !frequency.includes('clipped()'),
  'Frequency must not mask family-layout problems with scaling or clipping');
assert(frequency.includes('private var columnCount: Int { family == .systemMedium ? 10 : 7 }'),
  'Frequency medium must use its horizontal 10-column grid');
assert(frequency.includes('private static let dayCount = 30'),
  'Frequency must render exactly the 30-day domain window');
assert(frequency.includes('if family != .systemMedium'),
  'Only small/large may add weekday-leading presentation cells');

assert(frequencyMetrics.includes(
  'AJFitFrequencyMetrics(cellSize: 28, cellSpacing: 7, titleFont: 12,\n        footerFont: 11, logoSize: 29, verticalSpacing: 18, cornerRadius: 6)'
), 'Frequency large approved metrics changed');
assert(frequencyMetrics.includes(
  'AJFitFrequencyMetrics(cellSize: 18, cellSpacing: 4, titleFont: 10,\n        footerFont: 10, logoSize: 21, verticalSpacing: 2, cornerRadius: 5)'
), 'Frequency medium horizontal metrics changed');
assert(frequencyMetrics.includes(
  'AJFitFrequencyMetrics(cellSize: 11, cellSpacing: 1.25, titleFont: 10,\n        footerFont: 9, logoSize: 21, verticalSpacing: 1.5, cornerRadius: 3)'
), 'Frequency small enlarged metrics changed');

// Conservative iPhone widget content bounds after AJFitCanvas padding. Small
// reserves six rows for the worst weekday offset; medium is exactly 10 x 3.
const smallGridWidth = 7 * 11 + 6 * 1.25;
const smallGridHeight = 6 * 11 + 5 * 1.25;
const mediumGridWidth = 10 * 18 + 9 * 4;
const mediumGridHeight = 3 * 18 + 2 * 4;
assert(smallGridWidth <= 109 && smallGridHeight <= 73,
  'Frequency small worst-case grid exceeds its conservative center bounds');
assert(mediumGridWidth <= 260 && mediumGridHeight <= 62,
  'Frequency medium 10x3 grid exceeds its conservative center bounds');

const weeklyStart = source.indexOf('private struct WeeklyStreakView');
const calendarStart = source.indexOf('private struct AJFitCalendarMetrics');
const weekly = source.slice(weeklyStart, calendarStart);
assert(weekly.includes('Image("AJFitLogo")'), 'WeeklyStreak must use the official logo');

assert(source.includes('private struct AJDecorativeMark'), 'CompactStreak decorative AJ is missing');
const decorativeStart = source.indexOf('private struct AJDecorativeMark');
const weeklyStartForDecoration = source.indexOf('private struct WeeklyStreakView');
const decorative = source.slice(decorativeStart, weeklyStartForDecoration);
assert(decorative.includes('AJOutlineGlyphs') && decorative.includes('.stroke('),
  'CompactStreak AJ must be a stroked glyph outline');
assert(decorative.includes('Color.white.opacity(0.09)'),
  'CompactStreak AJ outline must remain subtly translucent white');
assert(!decorative.includes('Text("AJ").foregroundColor(AJFitColors.background)'),
  'CompactStreak AJ interior must stay transparent, not be background-painted');
assert(source.includes('Weekly — statuses + complete:false'), 'Weekly representative preview is missing');
assert(source.includes('Frequency Small — enlarged + few'), 'Frequency small/enlarged preview is missing');
assert(source.includes('Frequency Medium — few'), 'Frequency medium/few preview is missing');
assert(source.includes('Frequency Medium — many'), 'Frequency medium/many preview is missing');
assert(source.includes('Frequency Large — many'), 'Frequency large/many preview is missing');
assert(source.includes('Frequency — empty state'), 'Frequency empty-state preview is missing');

console.log('validateWidgetRoots: PASS — 4 configurations, 7 supported family paths');
