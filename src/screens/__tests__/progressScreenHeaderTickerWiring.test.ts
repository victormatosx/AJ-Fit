import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

describe('ProgressScreen shared header + ticker', () => {
  it('uses the exact same header geometry as Treino/Dieta/Home', () => {
    expect(screen).toContain("paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between'");
    expect(screen).toContain("t('meta.todayLine'");
    expect(screen).toContain('<ProfileAvatar');
    expect(screen).toContain("{t('progress.header.title')}.");
  });

  it('feeds the avatar and date line from data the screen already has access to', () => {
    expect(screen).toContain('const { user, questionnaire, profile } = useAuth()');
    expect(screen).toContain('const headerDisplayName = profile?.profile.name || user?.displayName');
  });

  it('builds and renders the evolution ticker from already-loaded data, no new hooks', () => {
    expect(screen).toContain("from '../state/UnitsContext'");
    expect(screen).toContain('buildEvolutionProgressTickerItems({');
    expect(screen).toContain('<EvolutionProgressTicker items={evolutionTickerItems} />');
  });

  it('keeps the single shared panelHeader (header + ticker + selector) handed to all three tabs', () => {
    expect(screen).not.toContain('const title = (');
    expect(screen).toContain('<ProgressPhotosScreen pageHeader={panelHeader} />');
    expect(screen).toContain('{panelHeader}');
  });
});
