// Small DOM helpers shared by the web agent's UI modules.
export const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const text = (id: string, value: string | number) => {
  element(id).textContent = String(value);
};
