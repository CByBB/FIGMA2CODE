/** Clickable swatches for linear gradients extracted during conversion. */
import React from "react";
import { useState } from "react";

const GradientsPanel = (props: {
  gradients: {
    cssPreview: string;
    exportValue: string;
  }[];
  onColorClick: (color: string) => void;
}) => {
  const [isPressed, setIsPressed] = useState(-1);

  const handleButtonClick = (value: string, idx: number) => {
    setIsPressed(idx);
    setTimeout(() => setIsPressed(-1), 250);
    props.onColorClick(value);
  };

  return (
    <div className="va-panel flex w-full flex-col gap-2">
      <div className="flex items-center justify-between p-0 pb-1">
        <h2 className="m-0 flex items-center gap-2 text-[13px] font-semibold text-foreground">
          Gradients
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {props.gradients.length} gradient
          {props.gradients.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {props.gradients.map((gradient, idx) => (
          <button
            key={"button" + idx}
            className={`h-16 w-full rounded-lg text-sm shadow-sm transition-all duration-300 ${
              isPressed === idx
                ? "ring-4 ring-primary/50 animate-pulse"
                : "ring-0"
            }`}
            style={{ background: gradient.cssPreview }}
            onClick={() => {
              handleButtonClick(gradient.exportValue, idx);
            }}
          ></button>
        ))}
      </div>
    </div>
  );
};
export default GradientsPanel;
