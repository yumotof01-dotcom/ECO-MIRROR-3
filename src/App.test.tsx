import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

function openRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('ECO MIRROR 3 phase-1 application shell', () => {
  it('navigates to the research workspace and requests data explicitly', () => {
    openRoute('/');
    expect(screen.getByRole('heading', { level: 1, name: /自然のつながりを/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /研究ワークスペースへ/ }));
    expect(screen.getByRole('tablist', { name: /研究モード/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '地域データを読み込む' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/生態学的に検証済み/)).not.toBeInTheDocument();
  });

  it('opens the research mode selected on a home card', () => {
    openRoute('/');
    fireEvent.click(screen.getByRole('link', { name: /急変区間を調べる/ }));
    expect(screen.getByRole('tab', { name: /急変区間を調べる/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('supports four functional research-mode tabs, arrow keys, Home and End', () => {
    openRoute('/explore');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const rail = screen.getByRole('tablist');
    const scenario = within(rail).getByRole('tab', { name: /条件を試す/ });
    fireEvent.click(scenario);
    expect(scenario).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-scenario');
    expect(screen.getByText(/未来の発生確率ではありません/)).toBeInTheDocument();

    fireEvent.keyDown(scenario, { key: 'End' });
    const bridge = within(rail).getByRole('tab', { name: /自然の橋を比較/ });
    expect(bridge).toHaveAttribute('aria-selected', 'true');
    expect(bridge).toHaveFocus();
    expect(screen.getByText(/地権・工事・動物の移動は未検証/)).toBeInTheDocument();

    fireEvent.keyDown(bridge, { key: 'Home' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(scenario).toHaveFocus();
    fireEvent.keyDown(scenario, { key: 'ArrowLeft' });
    expect(tabs[0]).toHaveFocus();
  });

  it('changes regions without silently reusing a numerical result', () => {
    openRoute('/explore');
    fireEvent.change(screen.getByLabelText('研究地域'), { target: { value: 'odaiba' } });
    expect(screen.getByLabelText('研究地域')).toHaveValue('odaiba');
    expect(screen.getByRole('button', { name: '地域データを読み込む' })).toBeInTheDocument();
    expect(screen.queryByText('構造的PC')).not.toBeInTheDocument();
    expect(screen.queryByText(/PC =/)).not.toBeInTheDocument();
  });

  it('shows scientific limits, license and original dataset year', () => {
    openRoute('/evidence');
    expect(screen.getByRole('heading', { name: /科学的な根拠と/ })).toBeInTheDocument();
    expect(screen.getAllByText(/ESA WorldCover 2021 v200/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2021年の土地被覆分類/)).toBeInTheDocument();
    expect(screen.getByText(/未来の確率ではありません/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /公式データのDOI/ })).toHaveAttribute('href','https://doi.org/10.5281/zenodo.7254221');
  });

  it('does not render an unrelated page for an unknown URL', () => {
    openRoute('/study/missing');
    expect(screen.getByRole('heading', { name: /ページが見つかりません/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ホームへ戻る/ })).toBeInTheDocument();
  });
});
