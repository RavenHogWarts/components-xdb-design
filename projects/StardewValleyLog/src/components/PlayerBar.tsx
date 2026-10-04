/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { CSS_PREFIX } from '../types';
import { PlayerProfile, levelFromXp } from '../checkin/profile';
import { levelProgress } from '../checkin/game';
import { composeAvatar } from '../checkin/farmerRenderer';
import { SKILLS } from '../checkin/habit';

/** 玩家栏（进入存档后所有游戏页共享）：化身 + 名字 + 五技能等级/经验条 + 金币 + 退出 */
export function PlayerBar({ profile, onExit }: { profile: PlayerProfile; onExit?: () => void }) {
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    composeAvatar(profile.look)
      .then((url) => alive && setAvatar(url))
      .catch(() => alive && setAvatar(null));
    return () => {
      alive = false;
    };
  }, [profile.look]);

  const totalLevel = SKILLS.reduce((m, s) => m + levelFromXp(profile.skills?.[s.id] ?? 0), 0);

  return (
    <div className={`${CSS_PREFIX}playerBar`}>
      {avatar ? (
        <img className={`${CSS_PREFIX}playerAvatar`} src={avatar} alt={profile.name} />
      ) : (
        <span className={`${CSS_PREFIX}playerAvatar ${CSS_PREFIX}playerAvatarLoad`}>…</span>
      )}
      <div className={`${CSS_PREFIX}playerInfo`}>
        <div className={`${CSS_PREFIX}playerName`}>
          {profile.name} <em>· {profile.farmName}农场</em>
        </div>
        <div className={`${CSS_PREFIX}playerSkills`}>
          {SKILLS.map((s) => {
            const xp = profile.skills?.[s.id] ?? 0;
            const { level, pct } = levelProgress(xp);
            return (
              <span key={s.id} title={`${s.label}经验 ${xp}`}>
                <i style={{ background: s.color }} />
                {s.label} Lv.{level}
                <span className={`${CSS_PREFIX}skillBar`}>
                  <span
                    className={`${CSS_PREFIX}skillBarFill`}
                    style={{ width: `${Math.round(pct * 100)}%`, background: s.color }}
                  />
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <div className={`${CSS_PREFIX}playerGold`}>
        <b>Lv.{totalLevel}</b>
        <span>💰 {profile.gold ?? 0}</span>
        {onExit && (
          <button className={`${CSS_PREFIX}playerExit`} title="退出到存档选择" onClick={onExit}>
            🚪 存档
          </button>
        )}
      </div>
    </div>
  );
}
