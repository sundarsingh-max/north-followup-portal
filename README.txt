NORTH FOLLOW-UP PORTAL - PUBLIC GOOGLE SHEET VERSION

Your portal reads the public Google Sheet:
https://docs.google.com/spreadsheets/d/1xXbamQZ1rsZAxK3bMu-9vXq__n1yYvLVrqVqRxCePNQ

Tab expected: Dashboard
Sync: every 10 seconds.

IMPORTANT:
This version does NOT need Google Cloud or a service account.
It uses Google's public CSV feed. The sheet must remain publicly readable/published.
Because this is company operational data, use this public method only for testing unless
your company's security team explicitly approves public access.

SETUP:
1. Install Node.js LTS.
2. Open Command Prompt in this folder.
3. Run: npm install
4. Run: npm start
5. Open: http://localhost:3000

If the portal says "Sync error", check that the Dashboard tab is publicly readable.
