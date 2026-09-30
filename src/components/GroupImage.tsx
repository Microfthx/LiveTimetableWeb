import { createContext, useContext, useState } from "react";
import { Music2 } from "lucide-react";
import type { IdolGroup } from "../types/timetable";
import type { RuntimeGroupImages } from "../utils/poster";

export const RuntimeImageContext = createContext<RuntimeGroupImages>({});

interface Props {
  group: IdolGroup;
  className?: string;
}

export function GroupImage({ group, className = "" }: Props) {
  const runtimeImages = useContext(RuntimeImageContext);
  const [brokenSources, setBrokenSources] = useState<string[]>([]);
  const runtimeSource = runtimeImages[group.id];
  const existingSource = group.image_base64
    ? `data:${group.image_mime};base64,${group.image_base64}`
    : "";
  const source = [runtimeSource, existingSource].find(
    (candidate) => candidate && !brokenSources.includes(candidate),
  );
  return (
    <div className={`group-image ${className}`}>
      {source ? (
        <img
          src={source}
          alt={`${group.name} 团体图片`}
          onError={() => setBrokenSources((previous) => [...previous, source])}
        />
      ) : (
        <div
          className="group-image-placeholder"
          role="img"
          aria-label={`${group.name} 暂无图片`}
        >
          <Music2 aria-hidden="true" />
          <span>{group.name.slice(0, 2)}</span>
        </div>
      )}
    </div>
  );
}
