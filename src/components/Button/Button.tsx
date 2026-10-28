import style from "./Button.module.scss";

export const Button = ({
  id,
  className,
  ref,
  disabled,
  title,
  ariaLabel,
  onClick,
  type = "normal",
  children,
}: Button.Props) => {
  return (
    <button
      className={clsx(style.btn, className)}
      id={id}
      ref={ref}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      data-type={type}
    >
      {children}
    </button>
  );
};

export namespace Button {
  export interface Props extends React.PropsWithChildren {
    ref?: React.Ref<HTMLButtonElement>;
    id?: string;
    className?: string;
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    value?: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    type?: "normal" | "cancel" | "confirm";
  }
}
