import { ActionForm } from "@/components/action-form";
import { updateLimitsAction } from "@/app/actions/provider";

interface LimitsFormProps {
  grantId: string;
  maxRpm: number;
  maxTokensPerRequest: number;
  privacyFloor: string;
  expiresAt: number | null;
  showPrivacy: boolean;
}

function hoursUntil(expiresAt: number | null): number {
  return expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 36_000) / 100) : 0;
}

export function LimitsForm({ grantId, maxRpm, maxTokensPerRequest, privacyFloor, expiresAt, showPrivacy }: LimitsFormProps) {
  const hoursLeft = hoursUntil(expiresAt);
  return (
    <ActionForm action={updateLimitsAction} submitLabel="Save limits" className="space-y-3">
      <input type="hidden" name="grantId" value={grantId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <label>
          <span className="label">Requests / min</span>
          <input className="input" name="maxRpm" type="number" min={1} max={600} defaultValue={maxRpm} />
        </label>
        <label>
          <span className="label">Max tokens / request</span>
          <input className="input" name="maxTokensPerRequest" type="number" min={16} max={128000} defaultValue={maxTokensPerRequest} />
        </label>
        <label>
          <span className="label">Expires in (hours)</span>
          <input className="input" name="expiresInHours" type="number" min={0.01} max={720} step="any" defaultValue={hoursLeft} />
        </label>
        {showPrivacy ? (
          <label>
            <span className="label">Privacy floor</span>
            <select className="input" name="privacyFloor" defaultValue={privacyFloor}>
              <option value="fast">Fast (SIE)</option>
              <option value="private">Private (Darkbloom)</option>
              <option value="verified">Verified (Tinfoil)</option>
            </select>
          </label>
        ) : (
          <input type="hidden" name="privacyFloor" value={privacyFloor} />
        )}
      </div>
    </ActionForm>
  );
}
