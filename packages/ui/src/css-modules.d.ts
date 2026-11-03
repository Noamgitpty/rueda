/** Modules CSS des composants : classes locales, lues par `styles['nom']`. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
