import React from 'react';
import styles from './Legal.module.css';

export default function Privacy() {
    return (
        <div className={styles.legalContainer}>
            <div className={styles.header}>
                <h1 className={styles.title}>Privacy Policy</h1>
                <div className={styles.lastUpdated}>Last Updated: August 2026</div>
            </div>

            <h2>1. Information We Collect</h2>
            <p>We collect information you provide directly to us when you create an account, such as your email address, as well as data synced from third-party platforms (like Sleeper) to populate your league dashboards.</p>

            <h2>2. How We Use Your Information</h2>
            <p>Your information is used strictly to provide, maintain, and improve the App. We use your data to:</p>
            <ul>
                <li>Authenticate your login securely via Supabase.</li>
                <li>Process payments for Premium tools via Stripe.</li>
                <li>Display your fantasy rosters, matchups, and history.</li>
            </ul>

            <h2>3. Third-Party Services</h2>
            <p>We share necessary data with trusted third parties solely to operate the App:</p>
            <ul>
                <li><strong>Supabase:</strong> For secure database hosting and user authentication.</li>
                <li><strong>Stripe / RevenueCat:</strong> For secure payment processing. We do not store your credit card information on our servers.</li>
            </ul>

            <h2>4. Data Retention and Deletion</h2>
            <p>You have the right to request the deletion of your account and personal data at any time. If you wish to delete your account, you can disconnect your leagues and log out, or contact us for full database removal.</p>

            <h2>5. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of any major changes by updating the "Last Updated" date at the top of this document.</p>
        </div>
    );
}