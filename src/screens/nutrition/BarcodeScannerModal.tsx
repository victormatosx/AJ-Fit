import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type { Timestamp } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { CtaButton } from '../../components/ui/CtaButton';
import { useTheme } from '../../theme';
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
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>({ phase: 'scanning' });
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
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10, zIndex: 10 }}>
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 16, color: '#fff' }}>
              {t('barcodeScan.title')}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={handleClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color="#fff" />
            </Pressable>
          </View>

          {!permission ? null : !permission.granted ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
              <Icon name="camera" size={40} color="#fff" />
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: '#fff', textAlign: 'center' }}>
                {t('barcodeScan.permissionExplanation')}
              </Text>
              {permission.canAskAgain ? (
                <CtaButton onPress={() => { void requestPermission(); }}>{t('barcodeScan.permissionRequest')}</CtaButton>
              ) : (
                <CtaButton onPress={() => { void Linking.openSettings(); }}>{t('barcodeScan.permissionOpenSettings')}</CtaButton>
              )}
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: [...SUPPORTED_BARCODE_TYPES] }}
                onBarcodeScanned={state.phase === 'scanning' ? handleBarcodeScanned : undefined}
              />
              <View
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 32 }}
                pointerEvents="box-none"
              >
                {state.phase === 'scanning' ? (
                  <View style={{ width: '78%', height: 140, borderRadius: theme.radii.lg, borderWidth: 2, borderColor: '#fff' }} />
                ) : null}
              </View>

              {state.phase === 'resolving' ? (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
                  <ActivityIndicator color="#fff" size="large" />
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: '#fff', marginTop: 12 }}>
                    {t('barcodeScan.resolving')}
                  </Text>
                </View>
              ) : null}

              {state.phase === 'not_found' || state.phase === 'error' ? (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.75)', padding: 32 }}>
                  <View style={{ width: '100%', borderRadius: theme.radii.xl, backgroundColor: theme.colors.sheetBackground, borderWidth: 1, borderColor: theme.colors.border, padding: 22, gap: 14 }}>
                    <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 16, color: theme.colors.textPrimary, textAlign: 'center' }}>
                      {state.phase === 'not_found' ? t('barcodeScan.notFoundTitle') : t('barcodeScan.errorTitle')}
                    </Text>
                    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' }}>
                      {state.phase === 'not_found' ? t('barcodeScan.notFoundBody') : t('barcodeScan.errorBody')}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                      <CtaButton ghost onPress={resetForRetry} style={{ flex: 1 }}>{t('barcodeScan.tryAgain')}</CtaButton>
                      {state.phase === 'not_found' && onNotFound ? (
                        <CtaButton onPress={() => { handleClose(); onNotFound(); }} style={{ flex: 1 }}>
                          {t('barcodeScan.createManually')}
                        </CtaButton>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
