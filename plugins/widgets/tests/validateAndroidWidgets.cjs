const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const android = path.join(root, 'modules/ajfit-widgets/android');
const read = (relative) => fs.readFileSync(path.join(android, relative), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(`Android widget validation failed: ${message}`); };

const manifest = read('src/main/AndroidManifest.xml');
const storage = read('src/main/java/com/ajfit/widgets/AJFitWidgetsStorage.kt');
const moduleSource = read('src/main/java/com/ajfit/widgets/AJFitWidgetsModule.kt');
const coordinator = read('src/main/java/com/ajfit/widgets/AJFitWidgetCoordinator.kt');
const widgets = read('src/main/java/com/ajfit/widgets/AJFitGlanceWidgets.kt');
const model = read('src/main/java/com/ajfit/widgets/AJFitWidgetSnapshot.kt');
const gradle = read('build.gradle');
const widgetInfoXml = (name) => read(`src/main/res/xml/ajfit_${name}_widget_info.xml`);

for (const receiver of ['AJFitMonthlyWidgetReceiver', 'AJFitWeeklyWidgetReceiver', 'AJFitCompactWidgetReceiver', 'AJFitFrequencyWidgetReceiver']) {
  assert(manifest.includes(receiver), `${receiver} is not registered`);
}
assert(manifest.includes('android.intent.action.BOOT_COMPLETED'), 'boot rescheduling receiver is missing');
assert(storage.includes('const val PREFERENCES_FILE = "ajfit_widgets"'), 'SharedPreferences file changed');
assert(storage.includes('const val SNAPSHOT_KEY = "ajfit.widgets.snapshot.v1"'), 'snapshot key changed');
assert((storage.match(/AJFitWidgetCoordinator\.snapshotChanged/g) || []).length === 2,
  'write and clear must both refresh widgets');
assert(moduleSource.includes('AJFitWidgetCoordinator::snapshotChanged'), 'requestReload is not real');
assert(coordinator.includes('setAndAllowWhileIdle') && !coordinator.includes('setExact'), 'future refresh must use one inexact alarm');
assert(coordinator.includes('filter { it > nowMs }.minOrNull()'), 'scheduler must select only the next future entry');
assert(model.includes('optInt("schemaVersion", -1) != 1'), 'defensive schema check is missing');
assert(model.includes('private static') === false, 'Kotlin source contains invalid copied Swift structure');
assert(widgets.includes('SizeMode.Responsive'), 'Glance responsive sizing is missing');
assert(widgets.includes('widthDp >= 250f && heightDp < 190f') || model.includes('widthDp >= 250f && heightDp < 190f'),
  'horizontal frequency breakpoint is missing');
assert(model.includes('fun frequencyCells(): IntRange = 0 until 30'), 'frequency must render exactly 30 data cells');
assert(gradle.includes("androidx.glance:glance-appwidget:1.1.1"), 'pinned Glance dependency is missing');
assert(!widgets.includes('Firestore') && !model.includes('Firestore'), 'widget layer must not access Firestore');

// Regression guard for the ColorProvider(Int) footgun: `ColorProvider` is
// overloaded as (Color) for a fixed color and (Int) for an Android
// @ColorRes resource id. `android.graphics.Color.rgb/argb/WHITE/...` return
// a plain Int, which silently binds to the resource-id overload and crashes
// RemoteViews at inflate time with a NotFoundException for the packed color
// value (this exact bug shipped and broke every widget on a physical
// device). Every `ColorProvider(` call must be passed a Compose `Color`
// literal (the file's `ComposeColor` alias), never a bare Int/variable.
assert(!widgets.includes('import android.graphics.Color'),
  'android.graphics.Color must not be imported — it returns Int and silently matches ColorProvider(Int) (@ColorRes), not a fixed color');
const colorProviderCalls = widgets.match(/ColorProvider\(\s*([A-Za-z0-9_.]+)/g) || [];
assert(colorProviderCalls.length > 0, 'expected ColorProvider usages were not found');
for (const call of colorProviderCalls) {
  const arg = call.replace('ColorProvider(', '').trim();
  assert(arg.startsWith('ComposeColor'), `ColorProvider(${arg}...) must be constructed from ComposeColor, not a raw Int/resource id — got "${arg}"`);
}

// Widget-picker previews must stay wired to real per-widget art, not the
// generic Glance loading spinner and not a bare app-icon stand-in — both
// were observed causing the picker to show no useful preview. Android's
// `previewLayout` (API 31+) is the richer mechanism, but it was verified on
// a physical device (MIUI/Xiaomi launcher, Android 13) to be ignored by
// that launcher entirely, which falls straight back to `previewImage` — so
// `previewImage` must ALSO be a representative rendered bitmap, not just
// the app logo, for the preview to be useful in practice.
for (const name of ['monthly', 'weekly', 'compact', 'frequency']) {
  const xml = widgetInfoXml(name);
  assert(!/previewLayout="@layout\/glance_default_loading_layout"/.test(xml),
    `${name} widget info must not reuse the generic Glance loading layout (initialLayout) as its picker preview`);
  assert(xml.includes(`android:previewLayout="@layout/ajfit_preview_${name}"`),
    `${name} widget info is missing its dedicated previewLayout`);
  assert(xml.includes(`android:previewImage="@drawable/ajfit_preview_${name}"`),
    `${name} widget info's previewImage must be a representative rendered bitmap, not the bare app logo`);
  assert(fs.existsSync(path.join(android, `src/main/res/layout/ajfit_preview_${name}.xml`)),
    `ajfit_preview_${name}.xml preview layout resource is missing`);
  assert(fs.existsSync(path.join(android, `src/main/res/drawable-nodpi/ajfit_preview_${name}.png`)),
    `ajfit_preview_${name}.png preview bitmap resource is missing`);
}

console.log('validateAndroidWidgets: PASS — 4 receivers, snapshot/update/CNG/preview/ColorProvider contracts');
