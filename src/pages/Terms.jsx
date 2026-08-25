import React from 'react';
import styles from './Legal.module.css';

export default function Terms() {
    return (
        <div className={styles.legalContainer}>
            <div className={styles.header}>
                <h1 className={styles.title}>Terms of Service</h1>
                <div className={styles.lastUpdated}>Last Updated: August 2026</div>
            </div>

            <h2>1. Acceptance of Terms</h2>
            <p>By accessing and using Huddle Fantasy Football ("the App"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the App.</p>

            <h2>2. Description of Service</h2>
            <p>Huddle provides analytics, management tools, and third-party integrations (such as Sleeper) for fantasy sports leagues. We reserve the right to modify or discontinue any part of the service at any time.</p>

            <h2>3. Huddle Premium Subscriptions</h2>
            <p>Certain features require a paid subscription ("Huddle Premium").</p>
            <ul>
                <li>Subscriptions are billed via Stripe or your respective App Store.</li>
                <li>All payments are non-refundable unless required by applicable law.</li>
                <li>You may cancel your subscription at any time, and you will retain access to premium features until the end of your current billing cycle.</li>
            </ul>

            <h2>4. User Conduct</h2>
            <p>You agree not to use the App to harass other users, distribute spam, or attempt to exploit the platform's code or APIs.</p>

            <h2>5. Disclaimer of Warranties</h2>
            <p>The App is provided "as is". While we strive for 100% uptime, we do not guarantee that the service will be uninterrupted or error-free, particularly regarding third-party API syncs.</p>

            <p style={{ marginTop: '40px', textAlign: 'center' }}>
                Questions? Contact support via your league commissioner.
            </p>
        </div>
    );
}