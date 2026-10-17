import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type { Timestamp } from 'firebase/firestore';
import { Icon } from '../../components/ui/Icon';
import { NU, NuButton } from '../../components/nutrition/NuKit';
import { resolveFoodLogEntryByBarcode } from '../../services/foodLogCatalog';
import {
  beginBarcodeScan, endBarcodeScan, initialBarcodeScanGuardState, shouldAcceptBarcodeScan,
} from '../../nutrition/foodLog/barcodeScanGuard';
import { trackNutritionEvent } from '../../nutrition/analytics';
import type { FoodLogEntry, FoodLogSourceType } from '../../types/nutrition';

/** EAN/GTIN/UPC — the common retail-product barcode families (round brief §1); QR/PDF417/etc are never decoded here. */
const SUPPORTED_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

type ScanState =
  | { phase: 'scanning' }
  | { phase: 'resolving' }
  | { phase: 'not_found' }
  | { phase: 'error' };

/**
 * Barcode scanner for the Diary's "Registrar alimento" flow (round brief
 * §1/§6). Owns ONLY camera permission + scan debounce + resolution
 * state — the product confirmation/quantity step is the EXISTING
 * `RegisterMealScreen` grams/serving-unit overlay, reached by the caller
 * via `onResolved`; this component never renders its own confirmation UI.
 *
 * `onResolved`'s entry is already either locally cataloged or freshly
 * materialized server-side (`resolveFoodLogEntryByBarcode` owns that
 * distinction) — this component doesn't care which, it only reports the
 * final `FoodLogEntry`.
 *
 * Renders as a plain absolutely-positioned overlay, not its own `<Modal>`
 * — this is opened exclusively from inside `RegisterMealScreen`'s own
 * `pageSheet` Modal. Two independent native `<Modal>`s stacked on top of
 * each other is unreliable (the same class of bug fixed for
 * `MealDetailsScreen` + `MealFeedbackSheet`): dismissing the inner one
 * (the X here) can corrupt the outer one's (RegisterMealScreen's) native
 * presentation/touch chain, leaving it "frozen" to the next tap. A plain
 * full-bleed View has no such ambiguity.
 */
export function BarcodeScannerModal({
  visible, onClose, onResolved, onNotFound,
}: {
  visible: boolean;
  onClose: () => void;
  onResolved: (entry: FoodLogEntry<Timestamp>) => void;
  /** Lets the caller offer manual/custom-food creation as a fallback (round brief §4) — this component never invents macros itself. */
  onNotFound?: () => void;
}) {
  const { t } = useTranslation('nutrition');
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>({ phase: 'scanning' });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const guardRef = useRef(initialBarcodeScanGuardState());
  const requestIdRef = useRef(0);

  const resetForRetry = useCallback(() => {
    guardRef.current = initialBarcodeScanGuardState();
    setState({ phase: 'scanning' });
  }, []);

  const handleClose = useCallback(() => {
    guardRef.current = initialBarcodeScanGuardState();
    setState({ phase: 'scanning' });
    onClose();
  }, [onClose]);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    const code = result.data?.trim();
    const now = Date.now();
    if (!code || !shouldAcceptBarcodeScan(guardRef.current, code, now)) return;
    guardRef.current = beginBarcodeScan(guardRef.current, code);
    const requestId = ++requestIdRef.current;
    setState({ phase: 'resolving' });
    trackNutritionEvent({ name: 'barcode_scan_started' });

    resolveFoodLogEntryByBarcode(code)
      .then((result2) => {
        if (requestId !== requestIdRef.current) return;
        guardRef.current = endBarcodeScan(guardRef.current, Date.now());
        if (result2.status === 'local' && result2.entry) {
          trackNutritionEvent({ name: 'barcode_scan_resolved_local' });
          onResolved(result2.entry);
          return;
        }
        if (result2.status === 'materialized' && result2.entry) {
          const source = result2.entry.source.type as FoodLogSourceType;
          if (source === 'off' || source === 'fatsecret') {
            trackNutritionEvent({ name: 'barcode_scan_resolved_external', properties: { source } });
            trackNutritionEvent({ name: 'barcode_scan_materialized', properties: { source } });
          }
          onResolved(result2.entry);
          return;
        }
        if (result2.status === 'not_found') {
          trackNutritionEvent({ name: 'barcode_scan_not_found' });
          setState({ phase: 'not_found' });
          return;
        }
        trackNutritionEvent({ name: 'barcode_scan_failed', properties: { reason: 'network' } });
        setState({ phase: 'error' });
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        guardRef.current = endBarcodeScan(guardRef.current, Date.now());
        trackNutritionEvent({ name: 'barcode_scan_failed', properties: { reason: 'unknown' } });
        setState({ phase: 'error' });
      });
  }, [onResolved]);

  if (!visible) return null;

  return (
    <View
      onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60, backgroundColor: '#000', overflow: 'hidden' }}
    >
      {/* Keep the native preview untransformed: physically turning the phone
          already turns the camera image. Only the controls/guide rotate in
          this portrait-locked app, using the actual containing sheet size. */}
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...SUPPORTED_BARCODE_TYPES] }}
          onBarcodeScanned={state.phase === 'scanning' ? handleBarcodeScanned : undefined}
        />
      ) : null}
      <View style={{
        position: 'absolute',
        width: viewport.height,
        height: viewport.width,
        left: (viewport.width - viewport.height) / 2,
        top: (viewport.height - viewport.width) / 2,
        transform: [{ rotate: '90deg' }],
        opacity: viewport.width > 0 ? 1 : 0,
      }}>
        <View style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10, zIndex: 10 }}>
            <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 16, color: '#fff' }}>
              {t('barcodeScan.title')}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={handleClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color="#fff" />
            </Pressable>
          </View>

          {!permission ? null : !permission.granted ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
              <Icon name="camera" size={40} color="#fff" />
              <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, color: '#fff', textAlign: 'center' }}>
                {t('barcodeScan.permissionExplanation')}
              </Text>
              {permission.canAskAgain ? (
                <NuButton
                  onPress={() => { void requestPermission(); }}
                  accessibilityLabel={t('barcodeScan.permissionRequest')}
                  style={{ width: '100%', maxWidth: 320, flexShrink: 0 }}
                >
                  <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 16, lineHeight: 22, color: NU.white, textAlign: 'center', flexShrink: 1, marginHorizontal: 16 }}>
                    {t('barcodeScan.permissionRequest')}
                  </Text>
                </NuButton>
              ) : (
                <NuButton
                  onPress={() => { void Linking.openSettings(); }}
                  accessibilityLabel={t('barcodeScan.permissionOpenSettings')}
                  style={{ width: '100%', maxWidth: 320, flexShrink: 0 }}
                >
                  <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 16, lineHeight: 22, color: NU.white, textAlign: 'center', flexShrink: 1, marginHorizontal: 16 }}>
                    {t('barcodeScan.permissionOpenSettings')}
                  </Text>
                </NuButton>
              )}
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <View
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 12, gap: 12 }}
                pointerEvents="box-none"
              >
                {state.phase === 'scanning' ? (
                  <View style={{ width: '78%', maxWidth: 520, height: 110, borderRadius: 16, borderWidth: 2, borderColor: '#fff', overflow: 'hidden' }}>
                    {/* `.aj2-scan` sweep — purely decorative, no state of its own, matches the design's "linha branca de varredura animada". */}
                    <ScanSweep />
                  </View>
                ) : null}
                {state.phase === 'scanning' ? (
                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: '#fff', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                    {t('barcodeScan.landscapeHint')}
                  </Text>
                ) : null}
              </View>

              {state.phase === 'resolving' ? (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
                  <ActivityIndicator color="#fff" size="large" />
                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: '#fff', marginTop: 12 }}>
                    {t('barcodeScan.resolving')}
                  </Text>
                </View>
              ) : null}

              {state.phase === 'not_found' || state.phase === 'error' ? (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.75)', padding: 32 }}>
                  <View style={{ width: '100%', borderRadius: 16, backgroundColor: NU.panel, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 22, gap: 14 }}>
                    <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 16, color: NU.white, textAlign: 'center' }}>
                      {state.phase === 'not_found' ? t('barcodeScan.notFoundTitle') : t('barcodeScan.errorTitle')}
                    </Text>
                    <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint, textAlign: 'center' }}>
                      {state.phase === 'not_found' ? t('barcodeScan.notFoundBody') : t('barcodeScan.errorBody')}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                      <NuButton ghost onPress={resetForRetry} style={{ flex: 1 }}>{t('barcodeScan.tryAgain')}</NuButton>
                      {state.phase === 'not_found' && onNotFound ? (
                        <NuButton onPress={() => { handleClose(); onNotFound(); }} style={{ flex: 1 }}>
                          {t('barcodeScan.createManually')}
                        </NuButton>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** Purely decorative animated scan line — `aj2-scan` in the design doc. No state, no props: just loops top-to-bottom inside its (clipped) parent. */
function ScanSweep() {
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [translateY]);
  return (
    <Animated.View
      style={{
        position: 'absolute', left: '10%', right: '10%', height: 2, backgroundColor: '#fff', opacity: 0.85,
        transform: [{ translateY: translateY.interpolate({ inputRange: [0, 1], outputRange: [16, 94] }) }],
      }}
    />
  );
}
