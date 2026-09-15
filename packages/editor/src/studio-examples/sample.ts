// Deliberately separate example copies. These do not load or bind a writable project.
// Images are existing Surdet assets, not copied from the reference application.
import exterior from '../../../../examples/zero-after-midnight/content/assets/bg/convenience_exterior.png?url';
import apartment from '../../../../examples/zero-after-midnight/content/assets/bg/apartment_night.png?url';
import rooftop from '../../../../examples/zero-after-midnight/content/assets/bg/rooftop_rain.png?url';
import hesitant from '../../../../examples/zero-after-midnight/content/assets/portrait/zhirao_commute_hesitant.png?url';
import calm from '../../../../examples/zero-after-midnight/content/assets/portrait/zhirao_commute_calm.png?url';
import smile from '../../../../examples/zero-after-midnight/content/assets/portrait/zhirao_commute_smile.png?url';
import avatar from '../../../../examples/zero-after-midnight/content/assets/avatar/zhirao.png?url';

export const backgrounds = [
  { key: 'convenience_exterior', name: '雨夜 · 便利店外', url: exterior },
  { key: 'apartment_night', name: '零点 · 公寓', url: apartment },
  { key: 'rooftop_rain', name: '雨中的天台', url: rooftop },
];
export const portraits = [
  { key: 'hesitant', name: '犹豫', url: hesitant },
  { key: 'calm', name: '平静', url: calm },
  { key: 'smile', name: '微笑', url: smile },
];
export { avatar };

export interface ExampleScene { id: string; title: string; subtitle: string; text: string }
export const initialScenes: ExampleScene[] = [
  { id: 'store', title: '便利店来电', subtitle: '对白、表情与选择', text: `@scene store
// 摘取《零点之后》的对白用于布局示例；独立副本。
@bg convenience_exterior
@show zhirao:commute hesitant @ right
许知遥：你看见玻璃了吗？
主角：看见了。里面没有人。
许知遥：有一个人坐在最里面，背对着你。
@wait 500
主角：我只看见收银台。
许知遥：别进来。

玻璃倒影里，街对面有辆黑色轿车停着。
车灯没开，雨刷却在动。
@choice
  观察监控 -> @goto camera
  相信她的说法 -> @goto trust
  挂断电话 -> @goto leave

@label camera
主角：能看一下零点十七分的监控吗？
@end
@label trust
许知遥：门铃。它响第二次的时候，不要回头。
@end
@label leave
我把手机从耳边拿开。
@end
` },
  { id: 'call', title: '零点十七分', subtitle: '来电片段', text: `@scene call
// 摘取《零点之后》的对白用于布局示例；独立副本。
@bg apartment_night
@show zhirao:commute calm @ right
许知遥：别开灯。
主角：知遥？
许知遥：先回答我，你家的灯是不是还关着？
主角：你在哪？大家都在找你。
@wait 800
许知遥：别告诉他们你接到过这通电话。
她的声音很轻，像是贴着另一扇门说话。
@end
` },
  { id: 'stage', title: '天台 · 演出练习', subtitle: '素材与节奏示例', text: `@scene stage
// 演出控件示例，独立于正式作品。
@bg rooftop_rain
@show zhirao:commute calm @ center
雨还没有停。
@wait 600
@show zhirao:commute smile @ center
许知遥：你来了。
@end
` },
];
