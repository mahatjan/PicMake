/** 全局确认框与保存中提示 */
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import { useWorkspace } from "../store/workspace";
import { selectRun } from "../store/workspace/selectors";
import { closeConfirm } from "../store/workspace/actions";

export function AppDialogs() {
  const { t } = useTranslation();
  const confirm = useWorkspace((s) => s.confirm);
  const saving = useWorkspace((s) => selectRun(s).phase === "saving");

  return (
    <>
      <ConfirmDialog state={confirm} onCancel={closeConfirm} />
      {saving && (
        <p className="pm-saving" role="status">
          {t("status.saving")}
        </p>
      )}
    </>
  );
}
