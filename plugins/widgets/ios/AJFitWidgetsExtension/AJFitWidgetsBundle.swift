import SwiftUI
import WidgetKit

@main
struct AJFitWidgetsBundle: WidgetBundle {
  var body: some Widget {
    AJFitMonthlyWidget()
    AJFitWeeklyWidget()
    AJFitCompactWidget()
    AJFitFrequencyWidget()
  }
}
