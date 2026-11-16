import { HOLISTIC_VIEWER_PATH } from "@/lib/holistic/paths";

/**
 * The Holistic Assessment module, framed inside the app shell.
 *
 * The module is its own app (modules/holistic_assessment), served same-origin
 * through the /holistic/ proxy. It signs in with this app's DHIS2 connection,
 * so a viewer who has not connected is sent to the Connection page from
 * inside the frame. It keeps its own Ghana Health Service styling.
 */
export function HolisticWorkspace() {
  return (
    <iframe
      src={`/holistic/${HOLISTIC_VIEWER_PATH}`}
      title="Holistic Assessment"
      className="block h-[calc(100dvh-12rem)] min-h-[560px] w-full rounded-xl border border-hair bg-surface"
    />
  );
}
