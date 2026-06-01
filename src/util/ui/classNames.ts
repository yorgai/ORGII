/**
 * classNames utility function - for merging className
 *
 * Combines class names, filtering out falsy values.
 * Similar to clsx or classnames utilities.
 *
 * @example
 * classNames('foo', 'bar', isActive && 'active') // 'foo bar active' or 'foo bar'
 * classNames('foo', null, undefined, false, 'bar') // 'foo bar'
 */
export const classNames = (
  ...classes: (string | boolean | undefined | null)[]
): string => {
  return classes.filter(Boolean).join(" ");
};
