import { useEffect, useMemo, useState } from "react";

import type {
  SheetIssue,
  SheetTestResult,
} from "../services/googleSheets";

import type {
  ChecklistResult,
  CommissioningSpace,
  FloorRegion,
  TestDraftResult,
} from "../types/commissioning";

interface TestingPanelProps {
  space: CommissioningSpace;
  region: FloorRegion;
  savedResults: SheetTestResult[];
  issues: SheetIssue[];
  googleConnected: boolean;
  saving: boolean;

  onSave: (
    results: TestDraftResult[],
    issueDescriptions: Record<string, string>,
  ) => void;

  onResolveIssue: (issue: SheetIssue) => void;
  onConnect: () => void;
}

const RESULT_OPTIONS: Array<{
  value: Exclude<ChecklistResult, "not_checked">;
  label: string;
}> = [
  { value: "pass", label: "Pass" },
  { value: "issue", label: "Issue" },
  { value: "not_applicable", label: "N/A" },
];

function resultKey(
  checklistItemId: string,
  testId: string,
): string {
  return `${checklistItemId}::${testId}`;
}

export function testIssueKey(
  checklistItemId: string,
  testId: string,
): string {
  return `testing::${checklistItemId}::${testId}`;
}

function buildDraftResults(
  space: CommissioningSpace,
  savedResults: SheetTestResult[],
): TestDraftResult[] {
  const savedByKey = new Map(
    savedResults.map((result) => [
      resultKey(result.checklistItemId, result.testId),
      result,
    ]),
  );

  return space.items.flatMap((item) =>
    (item.tests ?? []).map((test) => {
      const saved = savedByKey.get(
        resultKey(item.id, test.id),
      );

      return {
        checklistItemId: item.id,
        testId: test.id,
        deviceType: item.deviceType,
        category: item.category,
        testLabel: test.label,
        result: saved?.result ?? "not_checked",
        notes: saved?.notes ?? "",
      };
    }),
  );
}

export default function TestingPanel({
  space,
  region,
  savedResults,
  issues,
  googleConnected,
  saving,
  onSave,
  onResolveIssue,
  onConnect,
}: TestingPanelProps) {
  const [draftResults, setDraftResults] = useState<
    TestDraftResult[]
  >(() => buildDraftResults(space, savedResults));

  const [issueDescriptions, setIssueDescriptions] = useState<
    Record<string, string>
  >({});

  const [validationMessage, setValidationMessage] =
    useState("");

  useEffect(() => {
    setDraftResults(buildDraftResults(space, savedResults));
    setIssueDescriptions({});
    setValidationMessage("");
  }, [space.id, savedResults]);

  const openIssuesByTest = useMemo(() => {
    const map = new Map<string, SheetIssue[]>();

    for (const issue of issues) {
      if (issue.status !== "open") {
        continue;
      }

      const current =
        map.get(issue.checklistItemId) ?? [];

      current.push(issue);
      map.set(issue.checklistItemId, current);
    }

    return map;
  }, [issues]);

  const groupedResults = useMemo(() => {
    return space.items
      .map((item) => ({
        item,
        tests: draftResults.filter(
          (result) =>
            result.checklistItemId === item.id,
        ),
      }))
      .filter((group) => group.tests.length > 0);
  }, [draftResults, space.items]);

  const completedCount = draftResults.filter(
    (result) => result.result !== "not_checked",
  ).length;

  function updateResult(
    checklistItemId: string,
    testId: string,
    update: Partial<TestDraftResult>,
  ): void {
    setDraftResults((current) =>
      current.map((result) =>
        result.checklistItemId === checklistItemId &&
        result.testId === testId
          ? { ...result, ...update }
          : result,
      ),
    );

    setValidationMessage("");
  }

  function chooseResult(
    result: TestDraftResult,
    value: ChecklistResult,
  ): void {
    updateResult(
      result.checklistItemId,
      result.testId,
      { result: value },
    );

    if (value !== "issue") {
      const key = resultKey(
        result.checklistItemId,
        result.testId,
      );

      setIssueDescriptions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function validateAndSave(): void {
    for (const result of draftResults) {
      if (result.result !== "issue") {
        continue;
      }

      const issueKey = testIssueKey(
        result.checklistItemId,
        result.testId,
      );

      const hasExistingIssue =
        (openIssuesByTest.get(issueKey) ?? []).length > 0;

      const descriptionKey = resultKey(
        result.checklistItemId,
        result.testId,
      );

      if (
        !hasExistingIssue &&
        !issueDescriptions[descriptionKey]?.trim()
      ) {
        setValidationMessage(
          `Describe the failed test for ${result.deviceType}: ${result.testLabel}`,
        );
        return;
      }
    }

    setValidationMessage("");
    onSave(draftResults, issueDescriptions);
  }

  return (
    <>
      <div className="panel-heading inspection-panel-heading">
        <p className="eyebrow">
          Floor {space.floor} functional testing
        </p>

        <h2>
          {space.roomNo === "N/A"
            ? region.label
            : space.roomNo}
        </h2>

        <p>{space.spaceType}</p>
      </div>

      <div className="inspection-overview">
        <div>
          <span>Configured tests</span>
          <strong>{draftResults.length}</strong>
        </div>

        <div>
          <span>Completed</span>
          <strong>
            {completedCount}/{draftResults.length}
          </strong>
        </div>

        <div>
          <span>Open issues</span>
          <strong>
            {
              issues.filter(
                (issue) =>
                  issue.status === "open" &&
                  issue.checklistItemId.startsWith(
                    "testing::",
                  ),
              ).length
            }
          </strong>
        </div>
      </div>

      {!googleConnected && (
        <div className="panel-message">
          Connect Google Sheets before saving test
          results.
          <button
            type="button"
            className="inline-link-button"
            onClick={onConnect}
          >
            Connect now
          </button>
        </div>
      )}

      {groupedResults.length === 0 ? (
        <div className="panel-message">
          No tests have been configured for the fixtures
          or controls in this room. Add a tests array to
          the relevant items in the floor spaces JSON.
        </div>
      ) : (
        groupedResults.map(({ item, tests }) => (
          <section
            className="testing-device-group"
            key={item.id}
          >
            <div className="inspection-group-heading">
              <div>
                <h3>{item.deviceType}</h3>
                <span>{item.category}</span>
              </div>

              <span>{tests.length} tests</span>
            </div>

            {item.notes && (
              <div className="fixture-reference-note">
                <span>Fixture description</span>
                <p>{item.notes}</p>
              </div>
            )}

            {item.locationNotes && (
              <div className="fixture-location-note">
                <span>Where to find it</span>
                <p>{item.locationNotes}</p>
              </div>
            )}

            <div className="testing-check-list">
              {tests.map((result) => {
                const issueId = testIssueKey(
                  result.checklistItemId,
                  result.testId,
                );

                const openIssues =
                  openIssuesByTest.get(issueId) ?? [];

                const descriptionKey = resultKey(
                  result.checklistItemId,
                  result.testId,
                );

                const definition = item.tests?.find(
                  (test) => test.id === result.testId,
                );

                return (
                  <article
                    className={`testing-check-card result-${result.result}`}
                    key={descriptionKey}
                  >
                    <div className="testing-check-title">
                      <strong>{result.testLabel}</strong>

                      {definition?.instructions && (
                        <p>{definition.instructions}</p>
                      )}
                    </div>

                    <div className="result-selector">
                      {RESULT_OPTIONS.map((option) => (
                        <button
                          type="button"
                          key={option.value}
                          data-result={option.value}
                          className={
                            result.result === option.value
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            chooseResult(
                              result,
                              option.value,
                            )
                          }
                        >
                          {option.label}
                        </button>
                      ))}

                      {result.result !== "not_checked" && (
                        <button
                          type="button"
                          className="clear-result-button"
                          onClick={() =>
                            chooseResult(
                              result,
                              "not_checked",
                            )
                          }
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <label className="item-notes-field">
                      <span>Testing notes</span>
                      <textarea
                        rows={2}
                        value={result.notes}
                        placeholder="Optional observation…"
                        onChange={(event) =>
                          updateResult(
                            result.checklistItemId,
                            result.testId,
                            {
                              notes: event.target.value,
                            },
                          )
                        }
                      />
                    </label>

                    {openIssues.map((issue) => (
                      <div
                        className="open-issue-card"
                        key={issue.issueId}
                      >
                        <div>
                          <span>Open issue</span>
                          <p>{issue.issueDescription}</p>
                        </div>

                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            onResolveIssue(issue)
                          }
                        >
                          Mark resolved
                        </button>
                      </div>
                    ))}

                    {result.result === "issue" &&
                      openIssues.length === 0 && (
                        <label className="issue-description-field">
                          <span>Issue description</span>

                          <textarea
                            rows={3}
                            value={
                              issueDescriptions[
                                descriptionKey
                              ] ?? ""
                            }
                            placeholder="Describe what failed and what correction is required…"
                            onChange={(event) =>
                              setIssueDescriptions(
                                (current) => ({
                                  ...current,
                                  [descriptionKey]:
                                    event.target.value,
                                }),
                              )
                            }
                          />
                        </label>
                      )}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}

      {validationMessage && (
        <div className="inspection-validation-message">
          {validationMessage}
        </div>
      )}

      <div className="inspection-save-bar">
        <button
          type="button"
          className="primary-button full-width"
          disabled={
            !googleConnected ||
            saving ||
            draftResults.length === 0
          }
          onClick={validateAndSave}
        >
          {saving ? "Saving…" : "Save testing results"}
        </button>
      </div>
    </>
  );
}