import React from 'react';
import styles from './Legal.module.css';

export default function Privacy() {
    return (
        <div className={styles.legalContainer}>
            <div className={styles.header}>
                <h1 className={styles.title}>Privacy Policy</h1>
                <div className={styles.lastUpdated}>Last Updated: September 2026</div>
            </div>

            <h2>1. Information We Collect</h2>
            <p>We collect information you provide directly to us when you create an account, such as your email address, as well as data synced from the third-party fantasy platforms you connect:</p>
            <ul>
                <li><strong>Sleeper:</strong> League, roster, matchup, transaction, and draft data, read from Sleeper's public API using the league ID or username you provide.</li>
                <li><strong>Yahoo:</strong> When you connect a Yahoo league, we receive and store a Yahoo-issued OAuth access token and refresh token authorizing us to read your Yahoo Fantasy league, team, roster, transaction, and draft data on your behalf. We never receive or store your Yahoo password.</li>
            </ul>

            <h2>2. How We Use Your Information</h2>
            <p>Your information is used strictly to provide, maintain, and improve the App. We use your data to:</p>
            <ul>
                <li>Authenticate your login securely via Supabase.</li>
                <li>Process payments for Premium tools via Stripe or RevenueCat.</li>
                <li>Display your fantasy rosters, matchups, transactions, drafts, and league history for both Sleeper and Yahoo leagues.</li>
                <li>Generate the App's AI-powered features (Start/Sit, Trade Grader, Draft Grader, Manager Evaluations) by sending the relevant roster, player, and league data to our AI provider to produce written analysis.</li>
            </ul>

            <h2>3. Third-Party Services</h2>
            <p>We share necessary data with trusted third parties solely to operate the App:</p>
            <ul>
                <li><strong>Supabase:</strong> For secure database hosting and user authentication.</li>
                <li><strong>Stripe / RevenueCat:</strong> For secure payment processing. We do not store your credit card information on our servers.</li>
                <li><strong>Yahoo Fantasy Sports API:</strong> To read your Yahoo league data once you authorize the connection through Yahoo's own login. This access is entirely under your control -- see Section 4.</li>
                <li><strong>Google Gemini (Google AI):</strong> To generate the App's AI analysis features. Relevant roster, player, and league data is sent to Google's API to produce that written content; it is used to generate your requested output and is not used by us to identify you to Google beyond that request.</li>
                <li><strong>Public NFL schedule data (e.g. ESPN's public scoreboard):</strong> Read-only, to display game schedules and matchup context. No personal or account data is sent to this source.</li>
            </ul>

            <h2>4. Your Yahoo Account Data</h2>
            <p>You can revoke Huddle's access to your Yahoo account at any time, either by disconnecting the league inside the App or directly through Yahoo's own account security settings (Yahoo &gt; Account Info &gt; Connected Apps). Revoking access stops the App from making further requests on your behalf; we delete the associated stored token when you disconnect the league inside the App.</p>

            <h2>5. Data Retention and Deletion</h2>
            <p>You have the right to request the deletion of your account and personal data at any time. If you wish to delete your account, you can disconnect your leagues (which also removes any stored Yahoo tokens) and log out, or contact us for full database removal.</p>

            <h2>6. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of any major changes by updating the "Last Updated" date at the top of this document.</p>
        </div>
    );
}