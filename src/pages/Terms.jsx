import React from 'react';
import styles from './Legal.module.css';

export default function Terms() {
    return (
        <div className={styles.legalContainer}>
            <div className={styles.header}>
                <h1 className={styles.title}>Terms of Service</h1>
                <div className={styles.lastUpdated}>Last Updated: September 2026</div>
            </div>

            <h2>1. Acceptance of Terms</h2>
            <p>By accessing and using Huddle Fantasy Football ("the App"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the App.</p>

            <h2>2. Description of Service</h2>
            <p>Huddle provides analytics, management tools, and third-party integrations for fantasy sports leagues hosted on Sleeper, Yahoo Fantasy Sports, and ESPN Fantasy Football. We reserve the right to modify or discontinue any part of the service, including support for any platform, at any time.</p>
            <p>Huddle is an independent, third-party application. It is not affiliated with, endorsed by, or sponsored by Sleeper, Yahoo Inc., ESPN, Inc., or the National Football League (NFL), and no such affiliation should be implied. All platform names, team names, and player names are the property of their respective owners and are used solely to identify and describe the leagues and data the App connects to.</p>

            <h2>3. Connecting a Yahoo, ESPN, or Sleeper Account</h2>
            <p>To use platform-connected features, you authorize the App to access your league data through each platform's own connection method:</p>
            <ul>
                <li><strong>Yahoo:</strong> You connect your Yahoo account through Yahoo's official sign-in (OAuth). We never see or store your Yahoo password. In exchange, Yahoo issues the App a token that lets it read your Yahoo Fantasy league, team, roster, transaction, and draft data on your behalf. You can revoke this access at any time from your Yahoo account's connected-apps settings, or by disconnecting the league inside Huddle; either way, Huddle's stored access to your Yahoo data is cut off.</li>
                <li><strong>ESPN:</strong> ESPN offers no equivalent OAuth login for third-party apps. A private ESPN league instead requires you to supply your own <code>espn_s2</code> and <code>SWID</code> browser session values, which you retrieve yourself from a browser signed into your ESPN account. These values function similarly to a login session for ESPN's fantasy data specifically, and Huddle stores them (the same way it stores a Yahoo token) solely to keep re-fetching your league's data on your behalf. You can remove this access at any time by disconnecting the league inside Huddle, or by signing out of ESPN in your browser, which invalidates the stored values.</li>
                <li><strong>Sleeper:</strong> Sleeper's public API does not use a login step, so connecting a Sleeper league only requires a username or league ID you provide. Because Sleeper has no way for the App to verify your identity, we cannot guarantee that a username was entered by its rightful owner -- see the in-App notices around league connection for how team claims are handled.</li>
            </ul>

            <h2>4. Player Projections, Odds, and Statistics Are Estimates</h2>
            <p>Point projections shown in the App are not sourced ready-made from any platform. For a Sleeper or Yahoo league, they are built by taking each player's statistical projection (yardage, touchdowns, receptions, and similar underlying stats) and scoring that stat line against your specific league's own scoring settings; ESPN publishes an applied point value already computed under your league's own rules, which the App displays as-is rather than recomputing. Because of that:</p>
            <ul>
                <li>Displayed projections are independent estimates (or, for ESPN, ESPN's own computed figures) and will not always match, point-for-point, what Sleeper, Yahoo, ESPN, or any other site shows natively for the same player and week.</li>
                <li>Playoff odds, championship odds, power rankings, and similar percentages are statistical estimates produced by the App's own simulation, not figures reported by any platform, and carry the uncertainty inherent in any such projection -- particularly early in a season, before many results exist.</li>
                <li>These figures are provided for informational and entertainment purposes only. They are not guaranteed to be accurate and should not be the sole basis for a lineup, waiver, trade, or draft decision.</li>
                <li>Live scores, player stats, and game status depend on third-party APIs (Sleeper, Yahoo, ESPN, and public NFL data sources) and public schedule data, and may be delayed, temporarily unavailable, or occasionally incorrect.</li>
                <li>ESPN league support covers rosters, matchups, standings, transactions, draft results, trophy-room champions, career manager records, and rivalry history across every season ESPN reports the league having existed. Because ESPN publishes no playoff bracket endpoint, one narrower slice of the Records page -- bracket-specific stats like the largest playoff blowout or closest playoff game -- isn't broken out separately for ESPN leagues yet the way it is for Sleeper and Yahoo.</li>
            </ul>

            <h2>5. AI-Generated Analysis</h2>
            <p>Features such as Start/Sit, Trade Grader, Draft Grader, and Manager Evaluations use a third-party AI model to generate written grades, commentary, and recommendations from your league's data. This content is AI-generated, may be inaccurate, incomplete, or reflect outdated assumptions about a player, and is provided for entertainment and informational purposes only -- it is not professional advice, and Huddle does not guarantee its accuracy.</p>

            <h2>6. League Dues Tracking</h2>
            <p>Any dues, buy-in, or payout tracking feature in the App is an informational bookkeeping tool only. Huddle does not collect, hold, process, or transfer real money between users, and is not a party to any wager, side agreement, or payout arrangement between league members. You are solely responsible for ensuring that any money pool your league runs complies with the laws applicable to you and your league mates.</p>

            <h2>7. Huddle Premium Subscriptions</h2>
            <p>Certain features require a paid subscription ("Huddle Premium").</p>
            <ul>
                <li>Subscriptions are billed via Stripe or your respective App Store.</li>
                <li>All payments are non-refundable unless required by applicable law.</li>
                <li>You may cancel your subscription at any time, and you will retain access to premium features until the end of your current billing cycle.</li>
            </ul>

            <h2>8. User Conduct</h2>
            <p>You agree not to use the App to harass other users, distribute spam, or attempt to exploit the platform's code or APIs.</p>

            <h2>9. Disclaimer of Warranties</h2>
            <p>The App is provided "as is". While we strive for 100% uptime, we do not guarantee that the service will be uninterrupted or error-free, particularly regarding third-party API syncs, live score updates, or AI-generated content.</p>

            <p style={{ marginTop: '40px', textAlign: 'center' }}>
                Questions? Contact support via your league commissioner.
            </p>
        </div>
    );
}