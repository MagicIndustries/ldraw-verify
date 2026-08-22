BERARD  = ("Stressing the Elements (Jamie Berard, LEGO Group, 2006)","https://www.hellobricks.com/pdf/jamieberard-brickstress-bf06.pdf")
BERARD2 = ("Berard on the deck being superseded (The Rambling Brick, 2017)","https://ramblingbrick.com/2017/07/29/stressed-by-the-elements-saturn-v-tiles-plates-and-the-legality-of-connections/")
SWOOSH  = ("Deck index (Swooshable)","https://swooshable.com/other-resources/stressing-the-elements")
BDP     = ("BrickLink Designer Program guidelines","https://www.bricklink.com/v3/designer-program/guidelines.page?guideline=series-4")
BDPTOS  = ("BrickLink Designer Program terms","https://www.bricklink.com/v3/designer-program/terms_of_service.page")
LEGOMB  = ("LEGO: building tips for master builders","https://www.lego.com/en-us/service/help-topics/article/building-tips-for-master-builders")
LEGOTEC = ("LEGO: tips for building with Technic elements","https://www.lego.com/en-us/service/help-topics/article/tips-for-building-with-lego-technic-elements")
LEGOIDE = ("LEGO Ideas: illegal techniques are NOT a rejection criterion","https://www.lego.com/en-us/service/help-topics/article/using-illegal-building-techniques-in-lego-ideas-challenges")
LEGOHOW = ("LEGO: how LEGO bricks work","https://www.lego.com/en-us/service/help-topics/article/how-do-lego-bricks-work")
LEGOQ   = ("LEGO: quality in every detail (moulding tolerance)","https://www.lego.com/en-us/history/articles/d-quality-in-every-detail")
SPEC    = ("LDraw File Format 1.0.2","https://www.ldraw.org/article/218.html")
MPD     = ("LDraw MPD specification","https://www.ldraw.org/article/47.html")
BFC     = ("LDraw Back Face Culling extension","https://www.ldraw.org/article/415.html")
COLOUR  = ("LDraw Colour Definition extension","https://www.ldraw.org/article/299.html")
LIBSTD  = ("LDraw official parts library standards","https://library.ldraw.org/documentation/ldraworg-official-parts-library-standards/general")
SNOT    = ("SNOT basics: geometry, techniques and pitfalls (BrickNerd)","https://bricknerd.com/home/snot-basics-geometry-techniques-and-pitfalls-3-18-2021")
ILLSNOT = ("Illegal SNOT: stressful techniques for sideways building (BrickNerd)","https://bricknerd.com/home/illegal-snot-stressful-techniques-for-sideways-building-9-7-23")
FOUND   = ("Former LEGO designer finds an illegal technique in a current set (Brickset)","https://brickset.com/article/129979/former-lego-designer-finds-illegal-technique-in-new-model")

L=[BERARD,BERARD2,SWOOSH]
B=[BDP,BDPTOS]
SOURCES={
 "L-01":L+[LEGOTEC],"L-02":L+[LEGOTEC],"L-03":L+[LEGOTEC],"L-04":L+[LEGOTEC],
 "L-05":L,"L-06":L,"L-07":L,"L-08":L,"L-09":L,"L-10":L+[ILLSNOT],"L-12":L,
 "D-01":L+[BDP],"D-02":L,"D-04":L,
 "B-01":B+[BERARD],"B-02":B,"B-03":B+[BERARD,FOUND],"B-04":B,"B-05":B,
 "B-06":B,"B-07":B+[LEGOMB],"B-08":B+[LEGOTEC],"B-09":[BDPTOS],
 "G-01":L+[ILLSNOT],"G-02":L,"G-03":[SNOT,LEGOHOW],
 "E-01":[SPEC],"E-02":[SPEC],"E-03":[SPEC,COLOUR],"E-04":[SPEC,SNOT],"E-05":[MPD,SPEC],
 "E-06":[BFC],"E-07":[LIBSTD],"E-08":[LIBSTD,SPEC],"E-09":[LIBSTD],"E-10":[SPEC],
 "T-01":[SNOT],"T-02":[SNOT],"T-03":[SNOT],"T-04":[SNOT],"T-05":[SNOT],
 "T-06":[SNOT,ILLSNOT],"T-07":[LEGOQ,LEGOHOW],"T-08":[SNOT],"T-09":[SNOT],
 "T-10":[SNOT],"T-11":[LEGOMB],
}
PART_BASE="https://library.ldraw.org/library/official/parts/"
