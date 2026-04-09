import * as Slider from "@radix-ui/react-slider";

export function NpSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  ariaLabel = "slider",
}) {
  return (
    <Slider.Root
      className="np-slider"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(values) => onValueChange(Number(values?.[0] ?? min))}
      aria-label={ariaLabel}
    >
      <Slider.Track className="np-slider__track">
        <Slider.Range className="np-slider__range" />
      </Slider.Track>
      <Slider.Thumb className="np-slider__thumb" aria-label={ariaLabel} />
    </Slider.Root>
  );
}
