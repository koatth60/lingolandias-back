import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  HttpStatus,
  HttpCode,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/guards/auth.guard';
// import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  findAll() {
    return this.usersService.findAll();
  }

  @Get('admin-dashboard')
  @HttpCode(HttpStatus.OK)
  adminDashboard() {
    return this.usersService.findAdminDashboard();
  }

  @Get('admin-stats')
  @HttpCode(HttpStatus.OK)
  getAdminStats() {
    return this.usersService.getAdminStats();
  }

  @Get('analytics')
  @HttpCode(HttpStatus.OK)
  getAnalytics() {
    return this.usersService.getAnalytics();
  }

  @Get('teachers')
  @HttpCode(HttpStatus.OK)
  findTeachers() {
    return this.usersService.findTeachers();
  }

  @Get('students/paginated')
  @HttpCode(HttpStatus.OK)
  findStudentsPaginated(@Query() query: any) {
    return this.usersService.findStudentsPaginated({
      page: parseInt(query.page) || 1,
      limit: Math.min(parseInt(query.limit) || 20, 100),
      search: query.search || '',
      language: query.language || '',
      unassignedOnly: query.unassignedOnly === 'true',
    });
  }

  @Get('student-schedules/:studentId')
  @HttpCode(HttpStatus.OK)
  getStudentSchedules(@Param('studentId') studentId: string) {
    return this.usersService.getStudentSchedules(studentId);
  }

  @Get('student-profile/:studentId')
  @HttpCode(HttpStatus.OK)
  getStudentProfile(@Param('studentId') studentId: string) {
    return this.usersService.getStudentProfile(studentId);
  }

  @Post('assignstudent')
  @HttpCode(HttpStatus.OK)
  assignStudent(@Body() body: any) {
    return this.usersService.assignStudent(body);
  }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.usersService.findOne(+id);
  // }

  @Post('updateuser')
  @HttpCode(HttpStatus.OK)
  async update(@Body() updateUser: any) {
    const updatedUser = await this.usersService.update(updateUser);
    return updatedUser;
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  remove(@Body() body: any) {
    const { email } = body;
    return this.usersService.remove(email);
  }

  @Post('add-event')
  @HttpCode(HttpStatus.OK)
  addEvent(@Body() body: any) {
    return this.usersService.addEvent(body);
  }

  @Post('removeStudentsFromTeacher')
  @HttpCode(HttpStatus.OK)
  removeStudentsFromTeacher(@Body() body: any) {
    return this.usersService.removeStudentsFromTeacher(body);
  }

  @Patch('modify-schedule')
  @HttpCode(HttpStatus.OK)
  async modifySchedule(@Body() body: any) {
    return this.usersService.modifySchedule(body);
  }

  @Post('removeEvents')
  @HttpCode(HttpStatus.OK)
  removeEvents(
    @Body() body: { eventIds: string[]; teacherId: string; studentId: string },
  ) {
    return this.usersService.removeEvents(body);
  }
}
