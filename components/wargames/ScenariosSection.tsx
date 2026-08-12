'use client';

/**
 * Boards, kept and carried.
 *
 * Two jobs that look alike and are not. Keeping a board under a name is local
 * bookkeeping — the working board is still the only one the map draws, and a
 * scenario is somewhere to put the Baltic contingency while you argue about the
 * Pacific one. Carrying a board off the machine is a different problem, because
 * a board is mostly references: what travels has to include the systems and
 * inventories those references point at. `lib/scenarios.ts` holds both rules.
 *
 * Loading a scenario goes through the same commit every other board change
 * does, so putting the wrong one on the map costs one Ctrl+Z.
 */

import { useRef, useState } from 'react';

import type { WarGames } from '@/lib/useWarGames';
import { bundleFilename, summariseBoard, type ImportReport, type Scenario } from '@/lib/scenarios';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date from the ISO string itself rather than from `toLocaleString`, which
 * renders differently on a server and a browser and turns a timestamp into a
 * hydration mismatch.
 */
function when(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return 'not dated';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "1 system", "3 systems" — the report counts ones often enough to matter. */
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** The browser's own download, which is the only way a page hands over a file. */
function download(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ScenarioRow({
  wg,
  scenario,
  active,
  onExport,
}: {
  wg: WarGames;
  scenario: Scenario;
  active: boolean;
  onExport: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(scenario.name);
  const [note, setNote] = useState(scenario.note ?? '');
  const [confirming, setConfirming] = useState(false);
  const summary = summariseBoard(scenario.board);

  if (editing) {
    return (
      <li className="wg-scenario editing">
        <label className="wg-field wide">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="wg-field wide">
          <span>Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What this board is for"
          />
        </label>
        <div className="wg-row">
          <button
            className="wg-btn accent"
            onClick={() => {
              wg.renameScenario(scenario.id, name, note);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            className="wg-btn"
            onClick={() => {
              setName(scenario.name);
              setNote(scenario.note ?? '');
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`wg-scenario${active ? ' on' : ''}`}>
      <div className="wg-scenario-head">
        <strong>{scenario.name}</strong>
        {active && <span className="wg-tag">on the map</span>}
      </div>
      <p className="wg-scenario-meta">
        {when(scenario.savedAt)} · {plural(summary.nations, 'nation')} ·{' '}
        {plural(summary.units, 'deployment')} · {summary.strength} strength
      </p>
      {scenario.note && <p className="wg-scenario-note">{scenario.note}</p>}

      <div className="wg-row wg-scenario-acts">
        <button className="wg-btn accent" onClick={() => wg.loadScenario(scenario.id)}>
          Load
        </button>
        <button className="wg-btn" onClick={onExport}>
          Export
        </button>
        <button className="wg-btn" onClick={() => wg.duplicateScenario(scenario.id)}>
          Copy
        </button>
        <button className="wg-btn" onClick={() => setEditing(true)}>
          Rename
        </button>
        {confirming ? (
          <button
            className="wg-btn danger"
            onClick={() => {
              wg.deleteScenario(scenario.id);
              setConfirming(false);
            }}
            onBlur={() => setConfirming(false)}
            autoFocus
          >
            Sure?
          </button>
        ) : (
          <button className="wg-btn danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export function ScenariosSection({ wg }: { wg: WarGames }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const summary = summariseBoard(wg.board);
  const empty = summary.units === 0 && summary.nations === 0;

  const exportOne = (id: string | null, label: string) => {
    const bundle = wg.exportBundle(id);
    if (bundle) download(bundleFilename(label), bundle);
  };

  const takeFile = async (file: File) => {
    setReport(null);
    setImportError(null);
    const result = wg.importBundle(await file.text());
    if (result.ok) setReport(result.report);
    else setImportError(result.error);
    // Cleared so that choosing the same file twice fires a change event again.
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <section className="wg-block">
        <h3 className="wg-h">
          Working board
          <span className="wg-h-note">
            {plural(summary.units, 'deployment')} · {plural(summary.nations, 'nation')}
          </span>
        </h3>

        {wg.activeScenario ? (
          <p className="wg-hint wg-hint-top">
            Loaded from <strong>{wg.activeScenario.name}</strong>, saved{' '}
            {when(wg.activeScenario.savedAt)}. Edits since then are on the working board only —
            <em> update</em> writes them back.
          </p>
        ) : (
          <p className="wg-hint wg-hint-top">
            This board is not saved under a name. It is still kept on disk and survives a reload;
            saving it as a scenario is what lets you come back to it after arranging another.
          </p>
        )}

        <div className="wg-row">
          {wg.activeScenario && (
            <button className="wg-btn" onClick={() => wg.updateScenario(wg.activeScenario!.id)}>
              Update {wg.activeScenario.name}
            </button>
          )}
          <button
            className="wg-btn"
            disabled={empty}
            onClick={() => exportOne(null, wg.activeScenario?.name ?? 'working-board')}
          >
            Export file
          </button>
        </div>

        <h4 className="wg-sub">Save as a scenario</h4>
        <label className="wg-field wide">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Baltic contingency"
          />
        </label>
        <label className="wg-field wide">
          <span>Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — what this board is meant to show"
          />
        </label>
        <div className="wg-row">
          <button
            className="wg-btn accent"
            disabled={!name.trim() || empty}
            onClick={() => {
              wg.saveScenario(name, note);
              setName('');
              setNote('');
            }}
          >
            {empty ? 'Nothing on the board' : 'Save as scenario'}
          </button>
        </div>
      </section>

      <section className="wg-block">
        <h3 className="wg-h">
          Scenarios
          <span className="wg-h-note">{wg.scenarios.length}</span>
        </h3>

        {wg.scenarios.length ? (
          <ul className="wg-scenarios">
            {wg.scenarios.map((scenario) => (
              <ScenarioRow
                key={scenario.id}
                wg={wg}
                scenario={scenario}
                active={wg.activeScenario?.id === scenario.id}
                onExport={() => exportOne(scenario.id, scenario.name)}
              />
            ))}
          </ul>
        ) : (
          <p className="wg-empty">
            No scenarios yet. Save the working board above and it appears here.
          </p>
        )}

        <p className="wg-note">
          Loading a scenario replaces what is on the map, and is undoable like any other board
          change. Systems and national inventories are not part of a scenario — a country does not
          forget its army when you switch boards.
        </p>
      </section>

      <section className="wg-block">
        <h3 className="wg-h">Import</h3>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="wg-file-input"
          id="wg-import"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void takeFile(file);
          }}
        />
        <label className="wg-btn wg-file" htmlFor="wg-import">
          Choose a bundle…
        </label>

        {importError && <p className="wg-note wg-warn">{importError}</p>}

        {report && (
          <p className="wg-note">
            <strong>{report.name}</strong> loaded — {plural(report.units, 'deployment')}, and filed
            as a scenario.
            {report.systemsAdded > 0 && ` ${plural(report.systemsAdded, 'system')} added.`}
            {report.systemsKept > 0 &&
              ` ${plural(report.systemsKept, 'system was', 'systems were')} already yours and ${
                report.systemsKept === 1 ? 'was' : 'were'
              } left alone, so some figures may differ from the sender's.`}
            {report.nationsAdded > 0 &&
              ` ${plural(report.nationsAdded, 'national inventory', 'national inventories')} added.`}
            {report.nationsKept > 0 &&
              ` ${plural(report.nationsKept, 'nation')} already had an inventory here and kept it.`}
          </p>
        )}

        <p className="wg-note">
          A bundle carries the board with the systems you authored and the inventories of the
          nations on it, because a board on its own is a list of ids that mean nothing elsewhere.
          Importing never overwrites a system or an inventory you already have — the board is
          undoable, those are not.
        </p>
      </section>
    </>
  );
}
