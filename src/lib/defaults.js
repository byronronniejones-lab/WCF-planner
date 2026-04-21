// Default config blobs used at app init. Verbatim extract from main.jsx
// (was bundled into LoginScreen.jsx by the Round-1 anchor over-sweep).
export const DEFAULT_WEBFORMS_CONFIG = {
  webforms:[
    {id:"pig-dailys",teamMembers:[],name:"Pig Daily Report",description:"Daily care report for each pig group",table:"pig_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-group",title:"Pig Group",system:false,fields:[
        {id:"batch_label",label:"Pig Group",type:"group_picker",groupType:"pig",required:true,system:true,enabled:true}
      ]},
      {id:"s-feed",title:"Count & Feed",system:false,fields:[
        {id:"pig_count",label:"# Pigs in group",type:"number",required:false,system:false,enabled:true},
        {id:"feed_lbs",label:"Feed given (lbs)",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"group_moved",label:"Group moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"nipple_drinker_moved",label:"Nipple drinker moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"nipple_drinker_working",label:"Nipple drinker working?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"troughs_moved",label:"Feed troughs moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"fence_walked",label:"Fence line walked?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"fence_voltage",label:"Fence voltage (kV)",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"issues",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"broiler-dailys",teamMembers:[],name:"Broiler Daily Report",description:"Daily care report for broiler batches",table:"poultry_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-group-feed",title:"Broiler Group & Feed",system:false,fields:[
        {id:"batch_label",label:"Broiler Group",type:"group_picker",groupType:"broiler",required:true,system:true,enabled:true},
        {id:"feed_type",label:"Feed Type",type:"button_toggle",options:["STARTER","GROWER"],required:true,system:false,enabled:true},
        {id:"feed_lbs",label:"Feed given (lbs)",type:"number",required:false,system:false,enabled:true},
        {id:"grit_lbs",label:"Grit given (lbs)",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"group_moved",label:"Group moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"waterer_checked",label:"Waterer checked?",type:"yes_no",required:false,system:false,enabled:true}
      ]},
      {id:"s-mortality",title:"Mortality",system:false,fields:[
        {id:"mortality_count",label:"# Mortalities",type:"number",required:false,system:false,enabled:true},
        {id:"mortality_reason",label:"Reason",type:"text",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"comments",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"layer-dailys",teamMembers:[],name:"Layer Daily Report",description:"Daily care report for layer flocks",table:"layer_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-group-feed",title:"Layer Group & Feed",system:false,fields:[
        {id:"batch_label",label:"Layer Group",type:"group_picker",groupType:"layer",required:true,system:true,enabled:true},
        {id:"feed_type",label:"Feed Type",type:"button_toggle",options:["STARTER","GROWER","LAYER"],required:true,system:false,enabled:true},
        {id:"feed_lbs",label:"Feed given (lbs)",type:"number",required:false,system:false,enabled:true},
        {id:"grit_lbs",label:"Grit given (lbs)",type:"number",required:false,system:false,enabled:true},
        {id:"layer_count",label:"Current layer count",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"group_moved",label:"Group moved?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"waterer_checked",label:"Waterer checked?",type:"yes_no",required:false,system:false,enabled:true}
      ]},
      {id:"s-mortality",title:"Mortality",system:false,fields:[
        {id:"mortality_count",label:"# Mortalities",type:"number",required:false,system:false,enabled:true},
        {id:"mortality_reason",label:"Reason",type:"text",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"comments",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"egg-dailys",teamMembers:[],name:"Egg Daily Report",description:"Daily egg collection report",table:"egg_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-collection",title:"Egg Collection",system:true,fields:[
        {id:"group1_pair",label:"Group 1",type:"egg_group",slot:1,required:true,system:true,enabled:true},
        {id:"group2_pair",label:"Group 2",type:"egg_group",slot:2,required:false,system:true,enabled:true},
        {id:"group3_pair",label:"Group 3",type:"egg_group",slot:3,required:false,system:true,enabled:true},
        {id:"group4_pair",label:"Group 4",type:"egg_group",slot:4,required:false,system:true,enabled:true}
      ]},
      {id:"s-summary",title:"Summary",system:false,fields:[
        {id:"dozens_on_hand",label:"Dozens on hand",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"comments",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"cattle-dailys",teamMembers:[],name:"Cattle Daily Report",description:"Daily care report for cattle herds",table:"cattle_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-herd",title:"Cattle Herd",system:true,fields:[
        {id:"herd",label:"Herd (mommas/backgrounders/finishers/bulls)",type:"herd_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-feeds",title:"Feeds & Minerals",system:true,fields:[
        {id:"feeds",label:"Feeds (multi-line, with creep toggle)",type:"feed_lines",required:false,system:true,enabled:true},
        {id:"minerals",label:"Minerals (multi-line)",type:"mineral_lines",required:false,system:true,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"fence_voltage",label:"Fence voltage (kV)",type:"number",required:false,system:false,enabled:true},
        {id:"water_checked",label:"Water source checked?",type:"yes_no",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"issues",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]},
    {id:"sheep-dailys",teamMembers:[],name:"Sheep Daily Report",description:"Daily care report for sheep flocks",table:"sheep_dailys",allowAddGroup:false,sections:[
      {id:"s-info",title:"Report Info",system:true,fields:[
        {id:"date",label:"Date",type:"date",required:true,system:true,enabled:true},
        {id:"team_member",label:"Team Member",type:"team_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-flock",title:"Sheep Flock",system:true,fields:[
        {id:"flock",label:"Flock (rams/ewes/feeders)",type:"flock_picker",required:true,system:true,enabled:true}
      ]},
      {id:"s-feed",title:"Feed",system:false,fields:[
        {id:"bales_of_hay",label:"Bales of Hay",type:"number",required:false,system:false,enabled:true},
        {id:"lbs_of_alfalfa",label:"Alfalfa (lbs)",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-minerals",title:"Minerals",system:false,fields:[
        {id:"minerals_given",label:"Minerals given?",type:"yes_no",required:false,system:false,enabled:true},
        {id:"minerals_pct_eaten",label:"% of Minerals Eaten",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-checks",title:"Daily Checks",system:false,fields:[
        {id:"fence_voltage_kv",label:"Fence Voltage (kV)",type:"number",required:false,system:false,enabled:true},
        {id:"waterers_working",label:"Waterers working?",type:"yes_no",required:false,system:false,enabled:true}
      ]},
      {id:"s-mortality",title:"Mortality",system:false,fields:[
        {id:"mortality_count",label:"Mortality count",type:"number",required:false,system:false,enabled:true}
      ]},
      {id:"s-comments",title:"Comments",system:false,fields:[
        {id:"comments",label:"Comments / Issues",type:"textarea",required:false,system:false,enabled:true}
      ]}
    ]}
  ]
}
