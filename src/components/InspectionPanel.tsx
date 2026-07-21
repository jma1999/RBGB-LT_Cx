import { useEffect, useMemo, useState } from "react";

import type {
  SheetComment,
  SheetIssue,
} from "../services/googleSheets";
import type {
  ChecklistItem,
  ChecklistResult,
  CommissioningSpace,
  FloorRegion,
  SpaceStatus,
} from "../types/commissioning";

interface InspectionPanelProps {
  space: CommissioningSpace;
  region: FloorRegion;
  issues: SheetIssue[];
  comments: SheetComment[];
  commentsLoading: boolean;
  googleConnected: boolean;
  saving: boolean;
  commentText: string;
  onCommentTextChange: (value: string) => void;
  onSave: (
    items: ChecklistItem[],
    issueDescriptions: Record<string, string>,
  ) => void;
  onResolveIssue: (issue: SheetIssue) => void;
  onAddComment: () => void;
  onConnect: () => void;
}

const STATUS_LABELS: Record<SpaceStatus, string> = {
  not_inspected: "Not inspected",
  in_progress: "In progress",
  passed: "Passed",
  issue: "Issue",
  not_applicable: "Not applicable",
};

const RESULT_OPTIONS: Array<{
  value: Exclude<ChecklistResult, "not_checked">;
  label: string;
}> = [
  { value: "pass", label: "Pass" },
  { value: "issue", label: "Issue" },
  { value: "not_applicable", label: "N/A" },
];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function cloneItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.map((item) => ({
    ...item,
    inspectionNotes: item.inspectionNotes ?? "",
    issueIds: [...item.issueIds],
  }));
}

export default function InspectionPanel({
  space,
  region,
  issues,
  comments,
  commentsLoading,
  googleConnected,
  saving,
  commentText,
  onCommentTextChange,
  onSave,
  onResolveIssue,
  onAddComment,
  onConnect,
}: InspectionPanelProps) {
  const [draftItems, setDraftItems] = useState<ChecklistItem[]>(() =>
    cloneItems(space.items),
  );
  const [issueDescriptions, setIssueDescriptions] = useState<
    Record<string, string>
  >({});
  const [validationMessage, setValidationMessage] = useState("");

  useEffect(() => {
    setDraftItems(cloneItems(space.items));
    setIssueDescriptions({});
    setValidationMessage("");
  }, [space.id, space.items]);

  const openIssuesByItem = useMemo(() => {
    const map = new Map<string, SheetIssue[]>();

    for (const issue of issues) {
      if (issue.status !== "open") {
        continue;
      }

      const current = map.get(issue.checklistItemId) ?? [];
      current.push(issue);
      map.set(issue.checklistItemId, current);
    }

    return map;
  }, [issues]);

  const lightingItems = draftItems.filter(
    (item) => item.category === "lighting",
  );
  const controlItems = draftItems.filter(
    (item) => item.category === "control",
  );
  const otherItems = draftItems.filter(
    (item) => item.category !== "lighting" && item.category !== "control",
  );

  const checkedCount = draftItems.filter(
    (item) => item.result !== "not_checked",
  ).length;
  const openIssueCount = issues.filter(
    (issue) => issue.status === "open",
  ).length;
  const completionPercent =
    draftItems.length === 0
      ? 0
      : Math.round((checkedCount / draftItems.length) * 100);

  function updateItem(
    itemId: string,
    update: Partial<ChecklistItem>,
  ): void {
    setDraftItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, ...update } : item,
      ),
    );
    setValidationMessage("");
  }

  function chooseResult(itemId: string, result: ChecklistResult): void {
    const item = draftItems.find((candidate) => candidate.id === itemId);

    updateItem(itemId, {
      result,
      observedQty:
        result === "pass" &&
        item?.observedQty === null &&
        item.expectedQty !== null
          ? item.expectedQty
          : item?.observedQty ?? null,
    });

    if (result !== "issue") {
      setIssueDescriptions((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
    }
  }


  function validateAndSave(): void {
    for (const item of draftItems) {
      if (
        item.result === "pass" &&
        item.expectedQty !== null &&
        item.observedQty === null
      ) {
        setValidationMessage(
          `Enter the observed quantity for ${item.deviceType} before marking it as passed.`,
        );
        return;
      }

      if (
        item.result === "pass" &&
        item.expectedQty !== null &&
        item.observedQty !== item.expectedQty
      ) {
        setValidationMessage(
          `${item.deviceType} has an expected quantity of ${item.expectedQty} but an observed quantity of ${item.observedQty}. Mark it as an issue or correct the quantity.`,
        );
        return;
      }

      const hasOpenIssue = (openIssuesByItem.get(item.id) ?? []).length > 0;
      if (
        item.result === "issue" &&
        !hasOpenIssue &&
        !issueDescriptions[item.id]?.trim()
      ) {
        setValidationMessage(
          `Describe the issue found for ${item.deviceType}.`,
        );
        return;
      }
    }

    setValidationMessage("");
    onSave(draftItems, issueDescriptions);
  }

  function renderChecklistGroup(
    title: string,
    items: ChecklistItem[],
  ) {
    if (items.length === 0) {
      return null;
    }

    return (
      <section className="inspection-group">
        <div className="inspection-group-heading">
          <h3>{title}</h3>
          <span>{items.length} items</span>
        </div>

        <div className="inspection-items">
          {items.map((item) => {
            const openIssues = openIssuesByItem.get(item.id) ?? [];

            return (
              <article
                className={`inspection-item-card result-${item.result}`}
                key={item.id}
              >
                <div className="inspection-item-title">
                  <div>
                    <strong>{item.deviceType}</strong>
                    <span>{item.category}</span>
                  </div>
                  <div className="expected-quantity">
                    <span>Expected</span>
                    <strong>{item.expectedQty ?? "—"}</strong>
                  </div>
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

                <label className="observed-field">
                  <span>Observed quantity</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={item.observedQty ?? ""}
                    placeholder={
                      item.expectedQty === null
                        ? "Optional"
                        : String(item.expectedQty)
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      updateItem(item.id, {
                        observedQty: value === "" ? null : Number(value),
                      });
                    }}
                  />
                </label>

                <div className="result-selector" aria-label="Inspection result">
                  {RESULT_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={
                        item.result === option.value ? "active" : ""
                      }
                      data-result={option.value}
                      aria-pressed={item.result === option.value}
                      onClick={() => chooseResult(item.id, option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                  {item.result !== "not_checked" && (
                    <button
                      type="button"
                      className="clear-result-button"
                      onClick={() => chooseResult(item.id, "not_checked")}
                    >
                      Clear
                    </button>
                  )}
                </div>

                <label className="item-notes-field">
                  <span>Inspection notes</span>
                  <textarea
                    rows={2}
                    value={item.inspectionNotes ?? ""}
                    placeholder="Record operation, condition, location, or access notes…"
                    onChange={(event) =>
                      updateItem(item.id, {
                        inspectionNotes: event.target.value,
                      })
                    }
                  />
                </label>

                {openIssues.map((issue) => (
                  <div className="open-issue-card" key={issue.issueId}>
                    <div>
                      <span>Open issue</span>
                      <p>{issue.issueDescription}</p>
                      <small>
                        Raised by {issue.createdBy} ·{" "}
                        {formatTimestamp(issue.createdAt)}
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() => onResolveIssue(issue)}
                      disabled={!googleConnected || saving}
                    >
                      Mark resolved
                    </button>
                  </div>
                ))}

                {item.result === "issue" && openIssues.length === 0 && (
                  <label className="issue-description-field">
                    <span>Issue description</span>
                    <textarea
                      rows={3}
                      value={issueDescriptions[item.id] ?? ""}
                      placeholder="Describe what failed, where it is, and what needs correction…"
                      onChange={(event) =>
                        setIssueDescriptions((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="panel-heading inspection-panel-heading">
        <p className="eyebrow">Floor {space.floor} inspection</p>
        <h2>{space.roomNo === "N/A" ? region.label : space.roomNo}</h2>
        <p>{space.spaceType}</p>
      </div>

      {!googleConnected && (
        <div className="panel-message">
          Connect Google Sheets before saving inspection results.
          <button type="button" className="inline-link-button" onClick={onConnect}>
            Connect now
          </button>
        </div>
      )}

      {space.notes.trim() && (
        <div className="space-reference-note">
          <span>Space reference</span>
          <p>{space.notes}</p>
        </div>
      )}

      <div className="inspection-overview">
        <div>
          <span>Room status</span>
          <strong className={`space-status status-${space.status}`}>
            {STATUS_LABELS[space.status]}
          </strong>
        </div>
        <div>
          <span>Checked</span>
          <strong>
            {checkedCount}/{draftItems.length}
          </strong>
        </div>
        <div>
          <span>Open issues</span>
          <strong>{openIssueCount}</strong>
        </div>
      </div>

      <div className="inspection-progress" aria-label="Inspection progress">
        <span style={{ width: `${completionPercent}%` }} />
      </div>

      {space.testedBy && space.testedAt && (
        <p className="last-inspection-meta">
          Last saved by {space.testedBy} · {formatTimestamp(space.testedAt)}
        </p>
      )}

      {renderChecklistGroup("Lighting fixtures", lightingItems)}
      {renderChecklistGroup("Control devices", controlItems)}
      {renderChecklistGroup("Other checks", otherItems)}

      {draftItems.length === 0 && (
        <div className="panel-message">
          No lighting or control items were found for this CSV space.
        </div>
      )}

      {validationMessage && (
        <div className="inspection-validation-message">{validationMessage}</div>
      )}

      <div className="inspection-save-bar">
        <button
          type="button"
          className="primary-button full-width"
          onClick={validateAndSave}
          disabled={!googleConnected || saving || draftItems.length === 0}
        >
          {saving ? "Saving inspection…" : "Save inspection"}
        </button>
        <p>
          Partial inspections are allowed. The room becomes green only when
          every item is passed or marked N/A and no issue remains open.
        </p>
      </div>

      <section className="comments-section inspection-comments-section">
        <h3>Room comments</h3>
        <textarea
          value={commentText}
          onChange={(event) => onCommentTextChange(event.target.value)}
          placeholder="Add a general room, access, coordination, or follow-up note…"
          rows={3}
          disabled={!googleConnected || saving}
        />
        <button
          type="button"
          className="secondary-button full-width"
          onClick={onAddComment}
          disabled={!commentText.trim() || !googleConnected || saving}
        >
          Save room comment
        </button>

        <div className="comments-list">
          {commentsLoading ? (
            <p className="muted-text">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="muted-text">No comments for this room.</p>
          ) : (
            comments.map((comment) => (
              <article className="comment-card" key={comment.commentId}>
                <span className="comment-category">{comment.category}</span>
                <p>{comment.comment}</p>
                <span>
                  {comment.createdBy} · {formatTimestamp(comment.createdAt)}
                </span>
              </article>
            ))
          )}
        </div>
      </section>
    </>
  );
}
