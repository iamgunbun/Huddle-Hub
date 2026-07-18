import React, { useState, useEffect } from 'react';
import { useLeague } from '../context/LeagueContext';
import styles from './Scoring.module.css';

export default function Scoring() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [scoringSettings, setScoringSettings] = useState({});

    // Mappings to translate Sleeper's raw API keys to clean text
    const scoringLabels = {
        pass_yd: "Passing Yards",
        pass_td: "Passing TD",
        pass_int: "Interception Thrown",
        pass_2pt: "Passing 2PT Conversion",
        rush_yd: "Rushing Yards",
        rush_td: "Rushing TD",
        rush_2pt: "Rushing 2PT Conversion",
        rec: "Receptions (PPR)",
        rec_yd: "Receiving Yards",
        rec_td: "Receiving TD",
        rec_2pt: "Receiving 2PT Conversion",
        bonus_rec_te: "TE Premium Bonus",
        fum_lost: "Fumbles Lost",
        fum: "Fumbles",
        fgm_0_19: "FG Made (0-19 Yds)",
        fgm_20_29: "FG Made (20-29 Yds)",
        fgm_30_39: "FG Made (30-39 Yds)",
        fgm_40_49: "FG Made (40-49 Yds)",
        fgm_50p: "FG Made (50+ Yds)",
        fgmiss: "FG Missed",
        xpm: "Extra Point Made",
        xpmiss: "Extra Point Missed",
        def_td: "Defense TD",
        ff: "Forced Fumble",
        fum_rec: "Fumble Recovery",
        int: "Interception Caught",
        sack: "Sack",
        safe: "Safety",
        blk_kick: "Blocked Kick",
        pts_allow_0: "Points Allowed (0)",
        pts_allow_1_6: "Points Allowed (1-6)",
        pts_allow_7_13: "Points Allowed (7-13)",
        pts_allow_14_20: "Points Allowed (14-20)",
        pts_allow_21_27: "Points Allowed (21-27)",
        pts_allow_28_34: "Points Allowed (28-34)",
        pts_allow_35p: "Points Allowed (35+)"
    };

    useEffect(() => {
        const fetchScoring = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}`);
                const data = await res.json();
                
                if (data?.scoring_settings) {
                    setScoringSettings(data.scoring_settings);
                }
            } catch (e) {
                console.error("Failed to load scoring settings:", e);
            } finally {
                setLoading(false);
            }
        };
        fetchScoring();
    }, [activeLeague]);

    if (loading) return <div className={styles.loading}>Loading Scoring Matrix...</div>;

    const renderCategory = (title, keys) => {
        const activeKeys = keys.filter(k => scoringSettings[k] !== undefined && scoringSettings[k] !== 0);
        if (activeKeys.length === 0) return null;

        return (
            <div className={styles.categoryCard}>
                <h3 className={styles.categoryTitle}>{title}</h3>
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <tbody>
                            {activeKeys.map(k => (
                                <tr key={k} className={styles.row}>
                                    <td className={styles.labelCell}>{scoringLabels[k] || k}</td>
                                    <td className={styles.valueCell}>
                                        <span className={scoringSettings[k] > 0 ? styles.positive : styles.negative}>
                                            {scoringSettings[k] > 0 ? '+' : ''}{scoringSettings[k]}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <i className="material-icons" style={{ fontSize: '48px', color: '#eebf1c', marginBottom: '15px' }}>format_list_numbered</i>
                <h1 className={styles.title}>Scoring Format</h1>
                <h2 className={styles.subtitle}>{activeLeague?.league_name}</h2>
            </div>
            
            <div className={styles.grid}>
                {renderCategory('Passing', ['pass_yd', 'pass_td', 'pass_int', 'pass_2pt'])}
                {renderCategory('Rushing', ['rush_yd', 'rush_td', 'rush_2pt', 'fum_lost', 'fum'])}
                {renderCategory('Receiving', ['rec', 'rec_yd', 'rec_td', 'rec_2pt', 'bonus_rec_te'])}
                {renderCategory('Kicking', ['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p', 'fgmiss', 'xpm', 'xpmiss'])}
                {renderCategory('Defense / Special Teams', ['def_td', 'ff', 'fum_rec', 'int', 'sack', 'safe', 'blk_kick', 'pts_allow_0', 'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20', 'pts_allow_21_27', 'pts_allow_28_34', 'pts_allow_35p'])}
            </div>
        </div>
    );
}