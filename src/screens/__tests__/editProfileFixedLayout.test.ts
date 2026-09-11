import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(new URL('../EditProfileScreen.tsx', import.meta.url), 'utf8');

describe('EditProfileScreen fixed layout', () => {
  it('keeps the form and save action in a non-scrolling safe-area layout', () => {
    expect(screen).not.toContain('ScrollView');
    expect(screen).toContain('<View style={styles.content}>');
    expect(screen).toContain('<SafeAreaView style={styles.safeArea}');
    expect(screen).toContain("edges={['top', 'bottom']}");
    expect(screen).toContain('<View style={styles.footer}>');
    expect(screen).toContain('styles.saveButton');
  });

  it('anchors the footer within the available height instead of pushing it below the viewport', () => {
    expect(screen).toContain('content: {\n    flex: 1,');
    expect(screen).toContain('footer: {\n    flex: 1,\n    minHeight: 62,');
    expect(screen).toContain("justifyContent: 'flex-end'");
    expect(screen).not.toContain('minHeight: 120');
    expect(screen).not.toContain('flexGrow: 1');
  });
});
