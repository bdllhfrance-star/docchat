export type DocumentOperationState =
  | "selected"
  | "queued"
  | "upload-transfer"
  | "uploading"
  | "validating"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "failed"
  | "retrying"
  | "replacing"
  | "deleting";

type DocumentOperationIconProps = {
  state: DocumentOperationState;
};

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.7,
};

export function DocumentOperationIcon({
  state,
}: DocumentOperationIconProps) {
  let content: React.ReactNode;

  switch (state) {
    case "selected":
    case "validating":
      content = (
        <>
          <path
            {...strokeProps}
            className="document-outline-draw"
            d="M6 2.8h7l5 5v13.4H6z"
          />
          <path {...strokeProps} d="M13 2.8v5h5" />
          {state === "selected" ? (
            <path {...strokeProps} className="document-result-draw" d="m9 15 2 2 4-4" />
          ) : (
            <path {...strokeProps} className="document-scan-line" d="M8.5 13h7" />
          )}
        </>
      );
      break;
    case "upload-transfer":
    case "uploading":
      content = (
        <>
          <path {...strokeProps} d="M6 3h8l4 4v14H6z" />
          <path {...strokeProps} d="M14 3v4h4" />
          <g className="document-upload-arrow">
            <path {...strokeProps} d="M12 17v-6" />
            <path {...strokeProps} d="m9.5 13.5 2.5-2.5 2.5 2.5" />
          </g>
        </>
      );
      break;
    case "extracting":
      content = (
        <>
          <path {...strokeProps} d="M6 3h8l4 4v14H6zM14 3v4h4" />
          {[11, 14, 17].map((y, index) => (
            <path
              {...strokeProps}
              className="document-extract-line"
              d={`M9 ${y}h6`}
              key={y}
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </>
      );
      break;
    case "chunking":
      content = (
        <g className="document-chunk-group">
          <rect {...strokeProps} x="4" y="5" width="7" height="5" rx="1.2" />
          <rect {...strokeProps} x="13" y="5" width="7" height="5" rx="1.2" />
          <rect {...strokeProps} x="4" y="14" width="7" height="5" rx="1.2" />
          <rect {...strokeProps} x="13" y="14" width="7" height="5" rx="1.2" />
        </g>
      );
      break;
    case "embedding":
      content = (
        <>
          <path {...strokeProps} d="M4 12h16" opacity="0.35" />
          {[5, 8.5, 12, 15.5, 19].map((x, index) => (
            <circle
              className="document-vector-dot"
              cx={x}
              cy="12"
              fill="currentColor"
              key={x}
              r="1.45"
              style={{ animationDelay: `${index * 120}ms` }}
            />
          ))}
        </>
      );
      break;
    case "indexing":
      content = (
        <g className="document-index-stack">
          <path {...strokeProps} d="m5 8 7-3 7 3-7 3z" />
          <path {...strokeProps} d="m5 12 7 3 7-3" />
          <path {...strokeProps} d="m5 16 7 3 7-3" />
        </g>
      );
      break;
    case "ready":
      content = (
        <>
          <circle {...strokeProps} className="document-ready-ring" cx="12" cy="12" r="9" />
          <path {...strokeProps} className="document-ready-check" d="m8 12.5 2.6 2.6 5.8-6" />
        </>
      );
      break;
    case "failed":
      content = (
        <g className="document-failure-once">
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="m9 9 6 6m0-6-6 6" />
        </g>
      );
      break;
    case "retrying":
      content = (
        <g className="document-retry-once">
          <path {...strokeProps} d="M19 8v5h-5" />
          <path {...strokeProps} d="M18 13a7 7 0 1 1-1.7-7.2L19 8" />
        </g>
      );
      break;
    case "replacing":
      content = (
        <>
          <path {...strokeProps} d="M6 3h8l4 4v14H6zM14 3v4h4" />
          <path {...strokeProps} className="document-replace-plus" d="M12 11v6m-3-3h6" />
        </>
      );
      break;
    case "deleting":
      content = (
        <g className="document-delete-once">
          <path {...strokeProps} d="M8 8v11h8V8M6 6h12M10 6V4h4v2" />
          <path {...strokeProps} d="M10.5 10.5v6m3-6v6" />
        </g>
      );
      break;
    default:
      content = (
        <>
          <circle {...strokeProps} cx="12" cy="12" r="9" opacity="0.45" />
          {[8, 12, 16].map((x, index) => (
            <circle
              className="document-queue-dot"
              cx={x}
              cy="12"
              fill="currentColor"
              key={x}
              r="1.1"
              style={{ animationDelay: `${index * 140}ms` }}
            />
          ))}
        </>
      );
  }

  return (
    <svg
      aria-hidden="true"
      className="size-5 overflow-visible"
      data-operation={state}
      viewBox="0 0 24 24"
    >
      {content}
    </svg>
  );
}
