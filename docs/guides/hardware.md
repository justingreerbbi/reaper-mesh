# Hardware

Reaper Mesh runs on inexpensive LoRa boards. You need at least **two boards** to send messages
between them, and **three** to test relaying. Any mix of supported boards works together.

> [!WARNING]
> Always attach the antenna before the radio transmits. Transmitting without an antenna can
> damage the radio. Reaper Mesh only supports the **US 915 MHz** band today; buy the 915 MHz
> version of each board.

## Choose a board

The [board list](../boards/README.md) compares every supported board and links to its page, with
what it is good for, its buttons, screen, battery and transmit power, and its developer details.

Other boards, and other bands such as EU 868 MHz, are not supported yet. Adding a board needs a
validated hardware profile and physical testing; see
[Adding a board](../contributing/adding-a-board.md).

## What else you need

- A **915 MHz antenna** for each board, if it has no built-in one (usually included).
- A **USB data cable**, not a charge-only cable.
- A computer with **Chrome, Edge or Brave** for the web portal and the firmware installer. USB uses
  Web Serial and Bluetooth uses Web Bluetooth; Safari and Firefox support neither.
- A battery, if the board takes one and you want to use it unplugged. Each board's page says which.

## Transmit power

Power is set as low, medium or high, so the same setting works on every board. Each board's page
gives its values, in dBm at the radio chip before antenna gain. The default is medium. Output power
on real units has not been measured. Details:
[Radio configuration](../reference/radio-configuration.md#transmit-power).

## When the radio is allowed to transmit

A freshly flashed board is silent. It transmits only when all of these are true:

1. The radio mode is **Mesh** (Off and Listen never transmit).
2. A **radio network** is chosen: Open mode or a team.
3. The region is **US**, and the board's profile confirms the band and antenna.
4. The radio chip passed its startup probe.

The firmware never guesses the region from your computer's time zone.

## Buttons

Every board has one **main button**; its page says which one it is. On boards with a screen, one
press turns the screen on or off, two presses go to the next page, and a long press returns to the
main page. On every board, holding it for **5 seconds** opens Bluetooth pairing, and holding it
for **15 seconds** forgets every paired phone. See
[Device screen and buttons](../reference/device-display.md).

## Several boards on one computer

Several boards can be plugged into one computer at once. The web portal talks to one at a time,
and the two- and three-board test tools in `tools/` open each port separately.
