/** Clickable swatches for solid colors extracted during conversion. */
import { useState } from "react";
import { SolidColorConversion } from "types";

const ColorsPanel = (props: {
  colors: SolidColorConversion[];
  onColorClick: (color: string) => void;
}) => {
  const [isPressed, setIsPressed] = useState(-1);

  const handleButtonClick = (value: string, idx: number) => {
    setIsPressed(idx);
    setTimeout(() => setIsPressed(-1), 250);
    props.onColorClick(value);
  };

  /** Shorten CSS variable values for the swatch label */
  const formatColorValue = (value: string) => {
    if (value.includes("var(--")) {
      const varMatch = value.match(/var\(--([\w-]+)/);
      return varMatch ? `--${varMatch[1]}` : value;
    }
    return value;
  };

  return (
    <div className="va-panel flex w-full flex-col gap-2">
      <div className="flex items-center justify-between p-0 pb-1">
        <h2 className="m-0 flex items-center gap-2 text-[13px] font-semibold text-foreground">
          Color Palette
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {props.colors.length} color{props.colors.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {props.colors.map((color, idx) => (
          <button
            key={"button" + idx}
            className={`w-full h-16 rounded-lg text-sm font-semibold shadow-sm transition-all duration-300 ${
              isPressed === idx
                ? "ring-4 ring-primary ring-opacity-50 animate-pulse"
                : "ring-0"
            }`}
            style={{ backgroundColor: color.hex }}
            onClick={() => {
              handleButtonClick(color.exportValue, idx);
            }}
            title={color.exportValue}
          >
            <div className="flex flex-col h-full justify-center items-center">
              <span
                className={`text-xs font-semibold ${
                  color.contrastWhite > color.contrastBlack
                    ? "text-white"
                    : "text-black"
                }`}
              >
                {color.colorName ? color.colorName : `#${color.hex}`}
              </span>
              {color.exportValue !== `#${color.hex}` && (
                <span
                  className={`text-[10px] opacity-70 max-w-full truncate px-1 ${
                    color.contrastWhite > color.contrastBlack
                      ? "text-white"
                      : "text-black"
                  }`}
                >
                  {formatColorValue(color.exportValue)}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
export default ColorsPanel;
