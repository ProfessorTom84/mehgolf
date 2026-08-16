import asyncio
import http.server
import socketserver
import threading
import time
from playwright.async_api import async_playwright

PORT = 8092

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

def start_server():
    Handler = http.server.SimpleHTTPRequestHandler
    try:
        with ReusableTCPServer(("", PORT), Handler) as httpd:
            httpd.serve_forever()
    except Exception as e:
        print(f"Server exception: {e}")

async def run_tests():
    print("Starting background HTTP server...")
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    time.sleep(1)

    url = f"http://localhost:{PORT}"
    print(f"Connecting to {url} with Playwright...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Step 1: Open menu screen
        await page.goto(url)
        await page.wait_for_selector("#start-btn")
        print("Menu screen loaded successfully.")

        # Step 2: Click Tee off to start game
        await page.click("#start-btn")
        await page.wait_for_selector("#game:not(.hidden)")
        print("Game screen loaded.")

        # Dismiss initial course card banner if visible
        if await page.is_visible("#banner:not(.hidden)"):
            await page.click("#banner .btn.primary")
            await page.wait_for_selector("#banner", state="hidden")
            print("Dismissed opening banner.")

        # Step 3: Test Course Info Modal via #course-name click
        await page.click("#course-name")
        await page.wait_for_selector("#modal:not(.hidden)")
        modal_title = await page.inner_text("#modal-title")
        assert modal_title == "Clubhouse & Course Info", f"Expected title 'Clubhouse & Course Info', got '{modal_title}'"
        cc_name = await page.inner_text(".course-card .cc-name")
        print(f"Verified Course Info Modal opened for course: {cc_name}")

        # Close via #modal-close
        await page.click("#modal-close")
        await page.wait_for_selector("#modal", state="hidden")
        print("Closed modal via close button.")

        # Step 4: Test Course Info Modal via #clubhouse-btn
        await page.click("#clubhouse-btn")
        await page.wait_for_selector("#modal:not(.hidden)")
        assert await page.inner_text("#modal-title") == "Clubhouse & Course Info"
        await page.keyboard.press("Escape")
        await page.wait_for_selector("#modal", state="hidden")
        print("Verified Clubhouse button opens modal, closed via Escape key.")

        # Step 5: Test Shortcuts Modal via '?' key
        await page.keyboard.press("?")
        await page.wait_for_selector("#modal:not(.hidden)")
        shortcuts_title = await page.inner_text("#modal-title")
        assert shortcuts_title == "Keyboard Shortcuts", f"Expected title 'Keyboard Shortcuts', got '{shortcuts_title}'"
        kbd_count = await page.locator("kbd").count()
        assert kbd_count >= 8, f"Expected at least 8 <kbd> elements, found {kbd_count}"
        print(f"Verified Keyboard Shortcuts Modal via '?' key with {kbd_count} <kbd> elements.")

        # Toggle close via '?' key
        await page.keyboard.press("?")
        await page.wait_for_selector("#modal", state="hidden")
        print("Toggled Shortcuts modal closed via '?' key.")

        # Step 6: Test Shortcuts Modal via #shortcuts-btn
        await page.click("#shortcuts-btn")
        await page.wait_for_selector("#modal:not(.hidden)")
        assert await page.inner_text("#modal-title") == "Keyboard Shortcuts"
        await page.keyboard.press("Escape")
        await page.wait_for_selector("#modal", state="hidden")
        print("Verified Shortcuts button opens modal, closed via Escape.")

        # Step 7: Test gameplay action (roll & aim)
        await page.click("button:has-text('Roll the die')")
        await page.wait_for_selector(".aim-arrow", timeout=5000)
        print("Die rolled and aim arrows visible.")

        screenshot_path = "verification_screenshot.png"
        await page.screenshot(path=screenshot_path)
        print(f"Saved verification screenshot to {screenshot_path}")

        await browser.close()
        print("All verification assertions passed successfully!")

if __name__ == "__main__":
    asyncio.run(run_tests())
