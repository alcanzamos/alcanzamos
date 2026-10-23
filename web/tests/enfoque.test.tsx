import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFocoPendiente } from "../src/enfoque";

function Prueba() {
  const pedirFoco = useFocoPendiente();
  return (
    <>
      <button onClick={() => pedirFoco("campo")}>Pedir</button>
      <input id="campo" aria-label="campo" />
    </>
  );
}

describe("useFocoPendiente", () => {
  it("mueve el foco al elemento una vez dibujada la pantalla", () => {
    render(<Prueba />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByLabelText("campo")).toHaveFocus();
  });
});
